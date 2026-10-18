<?php
declare(strict_types=1);
// Website importers for clients other than Golden Auto. Dealer Car Search ("dcs") sites publish every vehicle page in
// their sitemap (/vdp/<id>/...) with a tracking object (utag_data: year, make, model, price, id) and a detail list
// (trim, colour, engine, mileage, stock, VIN). Photos are copied to this server by the photo worker
// (private/photo_worker.php, cron): every photo is downloaded and sorted by a local image model, and only whole-car
// exterior shots (doors closed) are kept, so asset sheets, the photo picker and video references use them.
require_once __DIR__.'/clients.php';
const DCS_PHOTO_LIMIT=150;
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

/** Save remote photos as local JPEG assets (same naming as ZIP imports). Returns [source URL => local file name]. */
function dcsStorePhotos(array $cfg,array $urls,callable $fetch):array {
    $out=[];$dir=$cfg['asset_dir']??__DIR__.'/../public/assets';
    foreach($urls as $url){
        $r=$fetch($url);if(($r['code']??0)!==200||strlen((string)$r['body'])<1000||strlen((string)$r['body'])>15000000)continue;
        $img=@imagecreatefromstring((string)$r['body']);if(!$img)continue;
        ob_start();imagejpeg($img,null,88);$jpg=(string)ob_get_clean();imagedestroy($img);
        $name=sha1($jpg).'.jpg';if(!is_file("$dir/$name")){file_put_contents("$dir/$name",$jpg,LOCK_EX);chmod("$dir/$name",0644);}
        $out[$url]=$name;
    }
    return $out;
}
/**
 * Label photos with the local image model (private/photo_classify.py): [file path => label]. Null when the model is
 * not installed or fails; callers then keep every photo.
 */
function photoClassify(array $cfg,array $paths):?array {
    $python=(string)($cfg['photo_python']??(getenv('HOME')?:'/home/mark').'/golden-auto-ml/bin/python');
    if(!$paths)return [];if(!is_executable($python))return null;
    $p=proc_open([$python,__DIR__.'/photo_classify.py'],[0=>['pipe','r'],1=>['pipe','w'],2=>['file','/dev/null','w']],$pipes);
    if(!is_resource($p))return null;
    fwrite($pipes[0],json_encode(['images'=>array_values($paths),'threads'=>(int)($cfg['photo_threads']??3)]));fclose($pipes[0]);
    $out=stream_get_contents($pipes[1]);fclose($pipes[1]);if(proc_close($p)!==0)return null;
    $d=json_decode((string)$out,true);if(!is_array($d['results']??null))return null;
    $labels=[];foreach($d['results'] as $r)if(isset($r['path'],$r['label']))$labels[$r['path']]=(string)$r['label'];
    return $labels;
}
/**
 * Photo worker step: for clients' website-imported cars whose photo set is new or changed, download every photo, sort
 * them, and keep the whole-car exterior shots (doors closed), in website order. Non-exterior copies are deleted.
 * Stops after $budget seconds; the next run continues. Returns log lines.
 */
function dcsProcessPhotos(PDO $db,array $cfg,int $budget=50,?callable $fetch=null,?callable $classify=null):array {
    $fetch??='clientFetch';$classify??=fn(array $paths)=>photoClassify($cfg,$paths);
    $start=time();$log=[];$dir=$cfg['asset_dir']??__DIR__.'/../public/assets';$base=rtrim((string)$cfg['public_base_url'],'/').'/assets/';
    foreach($db->query("SELECT id FROM state WHERE id LIKE 'inventory:%'")->fetchAll(PDO::FETCH_COLUMN) as $key){
        foreach(state($db,$key)['vehicles']??[] as $car){
            if(empty($car['photos_pending'])||($car['source']??'')!=='dcs')continue;
            if(time()-$start>$budget)return $log;
            $sources=array_slice($car['photo_sources']??[],0,DCS_PHOTO_LIMIT);
            $map=dcsStorePhotos($cfg,$sources,$fetch);
            $labels=$classify(array_map(fn($n)=>"$dir/$n",array_values($map)));
            $keep=[];$counts=[];
            foreach($map as $src=>$name){$label=$labels===null?'unsorted':($labels["$dir/$name"]??'error');$counts[$label]=($counts[$label]??0)+1;
                if($labels===null||$label==='exterior')$keep[]=$name;}
            // A model that found no exterior shot at all is more likely wrong than the website: keep everything.
            if(!$keep&&$map)$keep=array_values($map);
            // Delete dropped copies unless a saved car or sheet still uses the same file (identical photos share a name).
            $used=$db->prepare('SELECT COUNT(*) FROM state WHERE payload LIKE ?');
            foreach($map as $name)if(!in_array($name,$keep,true)&&is_file("$dir/$name")){$used->execute(['%'.$name.'%']);if((int)$used->fetchColumn()===0)unlink("$dir/$name");}
            // Save only this car, on the latest copy of the inventory (an import may have run meanwhile).
            $inv=state($db,$key)??['vehicles'=>[]];
            foreach($inv['vehicles'] as &$v)if($v['StockNumber']===$car['StockNumber']&&($v['photo_sources']??[])===($car['photo_sources']??[])){
                $v['photos']=array_map(fn($n)=>$base.$n,$keep);$v['photo_labels']=$counts;$v['photos_pending']=false;
                $v['photo_sources_done']=$car['photo_sources'];$v['photos_checked_at']=gmdate('c');unset($v['sheet_photos']);
            }unset($v);
            save($db,$key,$inv);
            $log[]=sprintf('%s %s: %d photos, kept %d exterior (%s)',$key,$car['StockNumber'],count($map),count($keep),json_encode($counts));
        }
    }
    return $log;
}

/** Year and name of a car from its sitemap address (/vdp/<id>/Used-2020-MercedesBenz-S560-for-sale-in-…), or ''. */
function dcsSitemapName(string $url): string {
    $slug=rawurldecode(basename((string)parse_url($url,PHP_URL_PATH)));
    return preg_match('~(?:^|-)((?:19|20)\d{2})-(.+?)(?:-for-sale(?:-.*)?)?$~',$slug,$m)?$m[1].' '.str_replace('-',' ',$m[2]):'';
}
/** Import error for one vehicle page from the sitemap, naming the car the sitemap gives. */
function dcsPageError(string $url, string $problem): string {
    $name=dcsSitemapName($url);
    return ($name!==''?$name:'A vehicle').' is listed in the website’s sitemap, but its page '.$problem.': '.$url;
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
        $r=$fetch($url);if(($r['code']??0)!==200){$errors[]=dcsPageError($url,'could not be loaded (HTTP '.($r['code']??0).')');continue;}
        try{$v=dcsParseVdp((string)$r['body'],$url);}catch(RuntimeException){$errors[]=dcsPageError($url,'has no year, make or model on the site (it may have been sold)');continue;}
        $dealer??=$v['dealer'];unset($v['dealer']);
        $prev=$byStock[$v['StockNumber']]??null;
        // Photos are copied and sorted by the photo worker; until then the car keeps the photos it had.
        $same=$prev&&($prev['photo_sources_done']??null)===$v['photo_sources'];
        $v['photos']=$prev['photos']??[];$v['photos_pending']=!$same;
        foreach(['photo_sources_done','photo_labels','photos_checked_at','sheet_photos'] as $k)if(isset($prev[$k]))$v[$k]=$prev[$k];
        $v['active']=true;$v['imported_at']=$prev['imported_at']??gmdate('c');$v['detail_checked_at']=gmdate('c');
        $prev?$updated++:$added++;$byStock[$v['StockNumber']]=$v;$seen[$v['StockNumber']]=true;
    }
    $gone=0;foreach($byStock as $stock=>&$v)if(!isset($seen[$stock])&&($v['active']??true)){$v['active']=false;$gone++;}unset($v);
    save($db,$key,['vehicles'=>array_values($byStock),'checked_at'=>gmdate('c'),'import'=>'dcs']);
    if($dealer){$c=clientsLoad($db);foreach($c['items'] as &$x)if($x['id']===$client['id'])$x['dealer']=$dealer;unset($x);save($db,'clients',$c);}
    return ['vehicles'=>array_values($byStock),'checked_at'=>gmdate('c'),'report'=>compact('added','updated','gone','errors')];
}
