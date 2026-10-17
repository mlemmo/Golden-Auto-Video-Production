<?php
declare(strict_types=1);
// Website importers for clients other than Golden Auto. Dealer Car Search ("dcs") sites publish every vehicle page in
// their sitemap (/vdp/<id>/...) with a tracking object (utag_data: year, make, model, price, id) and a detail list
// (trim, colour, engine, mileage, stock, VIN). Photos are copied to this server (first DCS_PHOTOS per car), so asset
// sheets, the photo picker and video references work exactly like imported cars.
require_once __DIR__.'/clients.php';
const DCS_PHOTOS=8;
const DCS_MAX_CARS=150;

/** Vehicle facts from one Dealer Car Search vehicle page, in the app's inventory shape (photos still remote). */
function dcsParseVdp(string $html,string $url):array {
    $u=[];
    if(preg_match('/init_utag_data\s*=\s*\{(.*?)\};/s',$html,$m)&&preg_match_all('/"(product_[a-z_]+|site_[a-z_]+)":\s*"([^"]*)"/',$m[1],$kv,PREG_SET_ORDER))
        foreach($kv as $p)$u[$p[1]]=html_entity_decode($p[2],ENT_QUOTES);
    $x=doc($html);$opt=[];
    foreach($x->query('//li[starts-with(@class,"detailOpt")]') as $li){
        $label=trim((string)$x->query('./label',$li)->item(0)?->textContent,": \t\n");
        $value=trim(preg_replace('/\s+/u',' ',substr($li->textContent,strlen((string)$x->query('./label',$li)->item(0)?->textContent))));
        if($label!==''&&$value!=='')$opt[$label]??=$value;
    }
    $notes='';foreach($x->query('//*[contains(concat(" ",normalize-space(@class)," ")," i05r_detailNotes ")]') as $n)$notes=trim(preg_replace('/\s+/u',' ',$n->textContent));
    $notes=trim(preg_replace('/^Vehicle Description\s*/i','',$notes));
    $year=(int)($u['product_year']??0);$make=trim((string)($u['product_make']??''));$model=trim((string)($u['product_model']??''));
    if($year<1900||$make===''||$model==='')throw new RuntimeException('Vehicle page is missing year, make or model: '.$url);
    // Highest positive advertised price: the tracking price and the displayed price.
    $prices=[];if(is_numeric($u['product_price']??null)&&(float)$u['product_price']>0)$prices[]=(float)$u['product_price'];
    foreach($x->query('//*[contains(@class,"price") and not(ancestor::form)]') as $n)
        if(preg_match('/^\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*$/',$n->textContent,$pm)&&(float)str_replace(',','',$pm[1])>0)$prices[]=(float)str_replace(',','',$pm[1]);
    // Trim on these sites carries dealer notes after asterisks ("S COUPE**LIFT**..."): keep the trim itself.
    $trim=trim(preg_split('/\*/',(string)($opt['Trim']??''))[0]);
    $photos=[];if(preg_match_all('~https://imagescdn\.dealercarsearch\.com/Media/\d+/'.preg_quote((string)($u['product_id']??''),'~').'/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)~i',$html,$pm))$photos=array_values(array_unique($pm[0]));
    $miles=preg_replace('/\D/','',(string)($opt['Mileage']??''));
    $stock=trim((string)($opt['Stock #']??''))?:(string)($u['product_id']??'');
    return ['source'=>'dcs','dcs_id'=>(string)($u['product_id']??''),'StockNumber'=>$stock,'Vin'=>trim((string)($opt['Vin']??''))?:'stock:'.$stock,
        'Year'=>$year,'Make'=>strtoupper($make),'Model'=>strtoupper($model),'Trim'=>$trim,'ExteriorColor'=>(string)($opt['Color']??''),
        'InteriorColor'=>(string)($opt['Interior Color']??$opt['Interior']??''),'Engine'=>(string)($opt['Engine']??''),'Transmission'=>(string)($opt['Transmission']??''),
        'Drivetrain'=>(string)($opt['Drive Train']??''),'Odometer'=>$miles===''?null:(int)$miles,'Condition'=>(string)($u['product_condition']??''),
        'VehiclePrice'=>$prices?max($prices):0,'price'=>$prices?max($prices):null,'description'=>$notes,'url'=>$url,'photo_sources'=>$photos,
        'dealer'=>array_filter(['name'=>$u['site_company_name']??null,'city'=>$u['site_company_city']??null,'state'=>$u['site_company_state']??null,'telephone'=>$u['site_phone_main']??null])];
}

/** Save remote photos as local JPEG assets (same naming as ZIP imports). Returns local URLs in order. */
function dcsStorePhotos(array $cfg,array $urls,callable $fetch):array {
    $out=[];$dir=$cfg['asset_dir']??__DIR__.'/../public/assets';$base=rtrim((string)$cfg['public_base_url'],'/').'/assets/';
    foreach($urls as $url){
        $r=$fetch($url);if(($r['code']??0)!==200||strlen((string)$r['body'])<1000||strlen((string)$r['body'])>15000000)continue;
        $img=@imagecreatefromstring((string)$r['body']);if(!$img)continue;
        ob_start();imagejpeg($img,null,88);$jpg=(string)ob_get_clean();imagedestroy($img);
        $name=sha1($jpg).'.jpg';if(!is_file("$dir/$name")){file_put_contents("$dir/$name",$jpg,LOCK_EX);chmod("$dir/$name",0644);}
        $out[]=$base.$name;
    }
    return $out;
}

/**
 * Import a Dealer Car Search client's inventory from its website. Cars that left the site stay listed as inactive;
 * photos are only copied for new cars or when the car's photo set changed. Returns a short report.
 */
function clientImportDcs(PDO $db,array $cfg,array $client,?callable $fetch=null):array {
    $fetch??='clientFetch';
    $sitemap=(string)($client['analysis']['sitemap']??'')?:$client['website'].'/sitemap';
    $s=$fetch($sitemap);if(($s['code']??0)!==200)throw new RuntimeException('Could not read the website’s sitemap (HTTP '.($s['code']??0).').');
    preg_match_all('~<loc>\s*(https://[^<\s]+/vdp/\d+/[^<\s]*)\s*</loc>~i',(string)$s['body'],$m);
    $pages=array_slice(array_values(array_unique($m[1])),0,DCS_MAX_CARS);
    if(!$pages)throw new RuntimeException('The sitemap lists no vehicle pages.');
    $key=clientInventoryKey($client['id']);$old=state($db,$key)??['vehicles'=>[]];$byStock=[];foreach($old['vehicles'] as $v)$byStock[$v['StockNumber']]=$v;
    $seen=[];$added=0;$updated=0;$errors=[];$dealer=null;
    foreach($pages as $url){
        $r=$fetch($url);if(($r['code']??0)!==200){$errors[]='HTTP '.($r['code']??0).' for '.$url;continue;}
        try{$v=dcsParseVdp((string)$r['body'],$url);}catch(RuntimeException $e){$errors[]=$e->getMessage();continue;}
        $dealer??=$v['dealer'];unset($v['dealer']);
        $prev=$byStock[$v['StockNumber']]??null;
        $keep=$prev&&($prev['photo_sources_used']??null)===array_slice($v['photo_sources'],0,DCS_PHOTOS)&&!empty($prev['photos']);
        $v['photo_sources_used']=array_slice($v['photo_sources'],0,DCS_PHOTOS);
        $v['photos']=$keep?$prev['photos']:dcsStorePhotos($cfg,$v['photo_sources_used'],$fetch);
        if(isset($prev['sheet_photos']))$v['sheet_photos']=$prev['sheet_photos'];
        $v['active']=true;$v['imported_at']=$prev['imported_at']??gmdate('c');$v['detail_checked_at']=gmdate('c');
        $prev?$updated++:$added++;$byStock[$v['StockNumber']]=$v;$seen[$v['StockNumber']]=true;
    }
    $gone=0;foreach($byStock as $stock=>&$v)if(!isset($seen[$stock])&&($v['active']??true)){$v['active']=false;$gone++;}unset($v);
    save($db,$key,['vehicles'=>array_values($byStock),'checked_at'=>gmdate('c'),'import'=>'dcs']);
    if($dealer){$c=clientsLoad($db);foreach($c['items'] as &$x)if($x['id']===$client['id'])$x['dealer']=$dealer;unset($x);save($db,'clients',$c);}
    return ['vehicles'=>array_values($byStock),'checked_at'=>gmdate('c'),'report'=>compact('added','updated','gone','errors')];
}
