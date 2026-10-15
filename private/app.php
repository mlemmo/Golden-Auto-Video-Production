<?php
declare(strict_types=1);
require_once __DIR__.'/import.php';
require_once __DIR__.'/references.php';
function jsonp(string $s): array {
    $s=trim($s);
    if (preg_match('/^[a-zA-Z_$][\w$]*\s*\((.*)\)\s*;?$/s',$s,$m)) $s=$m[1];
    $d=json_decode($s,true,512,JSON_THROW_ON_ERROR);
    if (!is_array($d)) throw new RuntimeException('Inventory response is invalid.');
    return $d;
}
function request(string $url, ?array $payload=null, string $key=''): string {
    // Authenticated Higgsfield POSTs go through the Python transport (see references.php).
    if($payload!==null&&$key!==''&&parse_url($url,PHP_URL_HOST)==='api.higgsfield.ai'){
        try{
            return uploadHttp('POST',$url,[
                'Authorization: Key '.$key,
                'Content-Type: application/json',
                'Accept: application/json'
            ],json_encode($payload,JSON_THROW_ON_ERROR));
        }catch(Throwable $e){
            throw new RuntimeException('Higgsfield API POST failed. Submission was not confirmed.',0,$e);
        }
    }

    if (!str_starts_with($url,'https://')) throw new RuntimeException('HTTPS is required.');
    $c=curl_init($url);
    $headers=['Accept: application/json,text/html','User-Agent: GoldenAutoInventoryVideo/1.0'];
    if ($key!=='') $headers[]='Authorization: Key '.$key;
    if ($payload!==null) $headers[]='Content-Type: application/json';
    curl_setopt_array($c,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>10,CURLOPT_TIMEOUT=>45,
        CURLOPT_FOLLOWLOCATION=>false,CURLOPT_HTTPHEADER=>$headers,CURLOPT_SSL_VERIFYPEER=>true]);
    if ($payload!==null) curl_setopt_array($c,[CURLOPT_POST=>true,CURLOPT_POSTFIELDS=>json_encode($payload,JSON_THROW_ON_ERROR)]);
    $body=curl_exec($c); $code=curl_getinfo($c,CURLINFO_RESPONSE_CODE); curl_close($c);
    if ($body===false || $code<200 || $code>=300) throw new RuntimeException('Remote request failed (HTTP '.$code.').');
    if (strlen($body)>8000000) throw new RuntimeException('Remote response is too large.');
    return $body;
}
function doc(string $html): DOMXPath {
    $d=new DOMDocument(); libxml_use_internal_errors(true); $d->loadHTML($html); libxml_clear_errors(); return new DOMXPath($d);
}
function highestPrice(array $vehicle, array $detail=[]): ?float {
    $p=[];
    foreach (array_merge([$vehicle],$detail) as $v) foreach (['VehiclePrice','TotalPrice','TotalAskingPrice','TotalAdvertisingPrice'] as $k)
        if (isset($v[$k]) && is_numeric($v[$k]) && (float)$v[$k]>0) $p[]=(float)$v[$k];
    return $p?max($p):null;
}
function money(?float $p): string { return $p===null?'Call for price':'$'.number_format($p,fmod($p,1.0)==0.0?0:2); }
/** Ad-copy price: whole dollars, cents dropped ($14,688.25 → "$14,688"). */
function adPrice(float $p): string { return '$'.number_format(floor($p)); }
function title(array $v): string {return trim(($v['Year']??'').' '.($v['Make']??'').' '.($v['Model']??''));}
function inventory(string $source): array {
    $html=request($source); $x=doc($html); $url=null;
    foreach ($x->query('//script[@src]') as $n) {
        $src=$n->getAttribute('src');
        if (str_contains($src,'cb=dws_inventory_listing_') && str_starts_with($src,'/inv-scripts-v2/inv/vehicles?')) {$url=$source.$src;break;}
    }
    if (!$url) throw new RuntimeException('Website inventory format changed; reader needs updating.');
    $d=jsonp(request($url)); $vehicles=$d['Vehicles']??null;
    if (!is_array($vehicles)) throw new RuntimeException('No readable vehicle list returned.');
    if (($d['TotalRecordCount']??count($vehicles))>count($vehicles)) throw new RuntimeException('Inventory exceeds this page; add pagination before syncing.');
    foreach ($vehicles as &$v) {
        $parts=array_map(fn($s)=>rawurlencode(strtolower(str_replace(' ','-',(string)$s))),[$v['Make'],$v['Model'],$v['StockNumber']]);
        $v['url']=$source.'/inventory/'.implode('/',$parts).'/'; $v['price']=highestPrice($v); $v['description']=''; $v['photos']=[];
    }
    return $vehicles;
}
function enrich(array $v): array {
    if(($v['source']??'')==='zip')return $v;
    $html=request($v['url']); $x=doc($html); $detail=[];
    // Price only from this vehicle's metadata and its own price widget: never related cars or loan calculators.
    foreach ($x->query('//meta[@name="description" or @property="og:description" or @property="product:price:amount"]') as $n) {
        $s=$n->getAttribute('content');
        if ($n->getAttribute('property')==='product:price:amount' && is_numeric($s)) $detail[]=['VehiclePrice'=>(float)$s];
        if (preg_match('/\$([\d,]+(?:\.\d{1,2})?)/',$s,$m)) $detail[]=['VehiclePrice'=>(float)str_replace(',','',$m[1])];
    }
    foreach ($x->query('//*[contains(concat(" ",normalize-space(@class)," ")," dws-vdp-seller-notes-container ")]') as $n) $v['description']=trim(preg_replace('/\s+/u',' ',$n->textContent));
    $v['photos']=galleryPhotos($html);
    $v['photos']=array_values(array_unique($v['photos'])); $v['price']=highestPrice($v,$detail);
    $v['detail_checked_at']=gmdate('c'); return $v;
}
function script(array $v,int $duration=15): string {
    if($duration===30)return script30($v);
    $name=title($v);$drive=$v['Drivetrain']??'';
    // Keep drive codes uppercase so speech spells them ("A,W,D") and captions keep "AWD".
    $feature=$drive?' with '.(preg_match('/^[A-Za-z0-9]{2,4}$/',$drive)?strtoupper($drive):strtolower($drive)):'';
    return 'Explore this '.$name.$feature.' at Golden Auto. '.
        ($v['price']!==null?'Just '.adPrice((float)$v['price']).'. ':'').
        'Book your test drive at mygoldenauto.net.';

}
const SPOKESPERSON_DEFAULT_DESCRIPTION='trustworthy friendly adult woman age 28–33, casual professional attire';
/**
 * 30-second script built only from inventory facts. Targets about 55–60 spoken words (roughly 22–25 s of speech),
 * which fits the 27.5 s left after the 2 s intro card; optional sentences are dropped for long vehicle names.
 */
function script30(array $v): string {
    $trimRaw=trim((string)($v['Trim']??''));
    $body=match(true){(bool)preg_match('/pickup|crew cab|truck/i',$trimRaw.' '.($v['Model']??''))=>'truck',
        (bool)preg_match('/sport utility|suv/i',$trimRaw)=>'SUV',(bool)preg_match('/sedan/i',$trimRaw)=>'sedan',
        (bool)preg_match('/coupe/i',$trimRaw)=>'coupe',(bool)preg_match('/van/i',$trimRaw)=>'van',default=>'vehicle'};
    // Trim name without the body-style suffix, e.g. "Premium Sport Utility 4D" → "Premium".
    $trim=trim(preg_replace('/\b(sport utility|sedan|coupe|pickup|crew cab|van|wagon|hatchback|convertible)\b.*$/i','',$trimRaw)??'');
    $name=title($v).($trim!==''&&stripos(title($v),$trim)===false?' '.$trim:'');
    $drive=['AWD'=>'all-wheel drive','4WD'=>'four-wheel drive','4X4'=>'four-wheel drive','FWD'=>'front-wheel drive','RWD'=>'rear-wheel drive'][strtoupper(trim((string)($v['Drivetrain']??'')))]??'';
    $color=strtolower(trim((string)($v['ExteriorColor']??'')));
    $miles=isset($v['Odometer'])&&$v['Odometer']!==null?(int)$v['Odometer']:null;
    $facts=array_values(array_filter([$drive,$color!==''?'a '.$color.' exterior':'',$miles!==null&&$miles>=1000?'just over '.number_format(intdiv($miles,1000)*1000).' miles':'']));
    $factLine=$facts?'It comes with '.(count($facts)>1?implode(', ',array_slice($facts,0,-1)).', and '.end($facts):$facts[0]).'.':'';
    $use=match($body){'truck'=>'It is ready for work during the week and adventures on the weekend.',
        'SUV'=>'It is a great fit for daily commutes, family errands, and weekend road trips.',
        default=>'It is a great fit for daily commutes and weekend drives.'};
    $parts=['hook'=>'Looking for a dependable '.$body.'?','name'=>'Take a look at this '.$name.', here at Golden Auto in San Ramon.',
        'facts'=>$factLine,'use'=>$use,'price'=>$v['price']!==null?'Just '.adPrice((float)$v['price']).'.':'',
        'cta'=>'Book your test drive today at mygoldenauto.net.'];
    $join=fn($p)=>trim(preg_replace('/\s+/',' ',implode(' ',array_filter($p)))??'');
    foreach(['use','hook'] as $optional)if(speechWordCount($join($parts))>62)unset($parts[$optional]);
    return $join($parts);
}
/**
 * Native-voice showroom shot (Seedance generate_audio): the spokesperson speaks the script herself, so voice,
 * lips and gestures come from one generation and no separate narration or lip-sync step is needed.
 * $speech is the pronunciation form (speechScript); captions use the display script.
 */
function promptNative(array $v,string $speech,int $duration=30,string $presenter=SPOKESPERSON_DEFAULT_DESCRIPTION): string {
    $presenter=rtrim(trim($presenter),'.');
    $speech=trim(preg_replace('/\s+/',' ',str_replace('"',"'",$speech))??'');
    if($speech==='')throw new RuntimeException('Write the script the spokesperson will say.');
    return 'Create a '.$duration.'-second dealership showroom video with synchronized spoken dialogue. '.
        'Reference image 1 is the exact vehicle asset sheet showing its front, sides and rear; reference image 2 is the spokesperson; match their face, hair, body and outfit exactly. '.
        'Preserve the vehicle paint, trim, wheels, lamps and body exactly; do not invent equipment, badges or license plates, and do not repair cosmetic imperfections. The vehicle is parked and stationary throughout. '.
        'Setting: a bright, upscale modern showroom with polished stone floors, warm architectural lighting and tall windows, not a representation of Golden Auto’s actual building. '.
        'Placement is critical: the spokesperson ('.$presenter.') is always in the foreground, between the camera and the car, closer to the camera than the car. She is never behind the car, never on its far side and never hidden by it; the car is always behind her or beside her, never in front of her. '.
        'She begins standing in front of the rear three-quarter corner of the car on the side nearest the camera, then walks slowly forward along that side toward the front three-quarter corner while presenting the car, ending in front of the front corner. '.
        'She is fully visible from head to at least the knees the whole time, faces the camera most of the time, and speaks directly to the viewer. Her lip movements match every word exactly; her expressions are warm and natural, and her relaxed open-hand gestures toward the car match what she is saying at that moment, with no repetitive or random gestures. '.
        'Camera: one slow, smooth, continuous tracking move on a stabilizer at her walking pace, slightly ahead of her, keeping her face clearly visible, well lit and reasonably large in frame while the car stays recognizable behind her. No hard cuts, no orbit to the far side of the car. '.
        'She speaks in a warm, clear, friendly American English voice at a natural, unhurried pace and says exactly this, word for word, and nothing else: "'.$speech.'" '.
        speechPronunciationGuide($speech).
        'Audio: only her voice, clear and close to the microphone, over a soft quiet room tone. No music, no other voices, no sound effects. '.
        'Leave space at the bottom of the frame for captions added in post-production. No on-screen text of any kind: no captions, no watermark, no website address, no logo, no signage text, no license-plate text.';
}
function speechPronunciationGuide(string $speech):string {
    $notes=[];foreach(SPEECH_PRONUNCIATION as $word=>$say)if(stripos($speech,$word)!==false)$notes[]='"'.$word.'" is pronounced '.$say;
    return $notes?'Pronunciation: '.implode('; ',$notes).'. ':'';
}
function prompt(array $v,string $spoken,string $style="dynamic",int $duration=15,string $presenter=SPOKESPERSON_DEFAULT_DESCRIPTION): string {
    $presenter=rtrim(trim($presenter),'.');
    // The voice comes later from the approved ElevenLabs narration via lip-sync, so the video is generated silent
    // with the spokesperson talking naturally (no script) and her face kept large and toward the camera for lip-sync.
    if ($style === "showroom") return 'Create a '.$duration.'-second dealership walkaround video. Reference image 1 is the exact vehicle asset sheet showing its front, sides and rear; reference image 2 is the spokesperson; match their face, hair, body and outfit exactly. Preserve the vehicle paint, trim, wheels, lamps and body exactly; do not invent equipment or repair cosmetic imperfections. The vehicle is parked throughout. '.
        'The spokesperson ('.$presenter.') begins at the rear three-quarter corner of the car on the side nearest the camera and walks slowly forward along that side to the front three-quarter corner, presenting the car. Never behind the car, never on its far side, never hidden by it. '.
        'Throughout, the spokesperson is fully visible from head to at least the knees, faces the camera most of the time, and talks to the viewer continuously with natural mouth movement, warm expressions and open hand gestures toward the car. '.
        'The stabilized camera tracks alongside at walking pace, slightly ahead of the spokesperson, keeping the face clearly visible, evenly lit and reasonably large in frame while the car stays recognizable beside them. One smooth continuous move; no hard cuts, no racing or drone shots. '.
        'Use a bright, modern illustrative showroom, not a representation of Golden Auto’s actual building. Leave space at the bottom of the frame for captions added in post-production. '.
        'No on-screen text of any kind: no watermark, no website address, no logo, no signage text, no license-plate text.';
    return 'Create a polished 15-second vehicle advertisement with energetic Hyper Motion style choreography. '.
        'Reference image 1 is the vehicle asset sheet, the authoritative visual identity. Reference image 2 is the recurring spokesperson. '.
        'Preserve the exact vehicle year, body, paint, wheels, lights, trim and interior shown in reference 1. No invented equipment or upgraded condition. '.
        'Vehicle: '.title($v).'; trim: '.($v['Trim']??'').'; exterior: '.($v['ExteriorColor']??'').'. '.
        '0–4 seconds: stabilized ultra-low tracking shot of this vehicle rolling down a clean sunlit street. '.
        '4–9 seconds: smooth matched transition to a slow macro glide across its actual dashboard, steering wheel and center console. Use leather only if visible in the reference. '.
        '9–15 seconds: fast drone dolly-out revealing this car at golden hour outside a modern illustrative showroom. Do not imply this fictional setting is Golden Auto’s actual building. '.
        'Continuous tracking within each scene; smooth transitions between scenes, no hard cuts. '.
        'Spokesperson appears in a lower-left inset, away from vehicle details, matching reference image 2 exactly: '.$presenter.', facing the camera and talking continuously with natural mouth movement and gestures. '.
        'Keep important content central and inset from frame edges. No on-screen text of any kind: no watermark, no website address, no logo; accurate captions are added in post-production.';
}
function db(array $cfg): PDO {
    if (!is_dir($cfg['data_dir'])) mkdir($cfg['data_dir'],0700,true);
    $p=new PDO('sqlite:'.$cfg['data_dir'].'/agent.sqlite');$p->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
    $p->exec('CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE, payload TEXT NOT NULL)');return $p;
}
function state(PDO $db,string $id): ?array {$q=$db->prepare('SELECT payload FROM state WHERE id=?');$q->execute([$id]);$s=$q->fetchColumn();return $s===false?null:json_decode($s,true,512,JSON_THROW_ON_ERROR);}
function save(PDO $db,string $id,array $data): void {$q=$db->prepare('INSERT OR REPLACE INTO state VALUES (?,?)');$q->execute([$id,json_encode($data,JSON_THROW_ON_ERROR)]);}
function publicImage(string $url): string {
    $p=parse_url($url); $host=strtolower($p['host']??'');
    if (($p['scheme']??'')!=='https' || !str_contains($host,'.') || filter_var($host,FILTER_VALIDATE_IP) || isset($p['user']) || isset($p['pass']) || isset($p['port'])) throw new RuntimeException('Use a public HTTPS image URL without credentials or a custom port.');
    // Block obvious private targets; Higgsfield imports references, this server does not fetch arbitrary URLs.
    if (preg_match('/(?:^|\.)(localhost|local|internal)$/',$host)) throw new RuntimeException('Use a publicly hosted reference image.');
    return $url;
}

function galleryPhotos(string $html): array {
    $x=doc($html);$photos=[];
    foreach ($x->query('//*[starts-with(@id,"DWS_VDP_Media_")]//*[@data-pin-media or @data-base-img-url]') as $n) {
        $url=$n->getAttribute('data-pin-media')?:$n->getAttribute('data-base-img-url');
        if (parse_url($url,PHP_URL_HOST)==='imagescf.dealercenter.net' && str_starts_with($url,'https://')) $photos[]=preg_replace('~^(https://imagescf\.dealercenter\.net)/[0-9]+/[0-9]+/~','$1/640/480/',$url);
    }
    if (!$photos) foreach ($x->query('//meta[@property="og:image"]') as $n) {
        $url=$n->getAttribute('content');
        if(parse_url($url,PHP_URL_HOST)==='imagescf.dealercenter.net' && str_starts_with($url,'https://')) $photos[]=preg_replace('~^(https://imagescf\.dealercenter\.net)/[0-9]+/[0-9]+/~','$1/640/480/',$url);
    }
    return array_values(array_unique($photos));
}
function samplePhotos(array $photos,int $count=9): array {
    $n=count($photos);if($n<=$count)return $photos;
    $out=[];for($i=0;$i<$count;$i++) $out[]=$photos[(int)round($i*($n-1)/($count-1))];return $out;
}
/** Default asset-sheet photos: the saved front/side/side/rear picks (1-based gallery positions), else the first four. */
function defaultSheetPhotos(array $v): array {
    $all=$v['photos']??[];$picked=[];
    foreach($v['sheet_photos']??[] as $n)if(isset($all[$n-1]))$picked[]=$all[$n-1];
    return $picked?:array_slice($all,0,4);
}
function downloadPhotos(array $urls): array {
    $multi=curl_multi_init();$handles=[];$buffers=[];
    foreach($urls as $i=>$url){
        if(parse_url($url,PHP_URL_HOST)!=='imagescf.dealercenter.net'||!str_starts_with($url,'https://'))throw new RuntimeException('Photo is not from the vehicle image provider.');
        $buffers[$i]='';$c=curl_init($url);curl_setopt_array($c,[CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>25,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_USERAGENT=>'GoldenAutoInventoryVideo/1.0',CURLOPT_WRITEFUNCTION=>function($ch,$chunk)use(&$buffers,$i){if(strlen($buffers[$i])+strlen($chunk)>4000000)return 0;$buffers[$i].=$chunk;return strlen($chunk);}]);curl_multi_add_handle($multi,$c);$handles[$i]=$c;
    }
    do{$status=curl_multi_exec($multi,$active);if($active)curl_multi_select($multi,1.0);}while($active && $status===CURLM_OK);
    $out=[];
    foreach($handles as $i=>$c){$code=curl_getinfo($c,CURLINFO_RESPONSE_CODE);if($code===200 && !curl_errno($c))$out[$i]=$buffers[$i];curl_multi_remove_handle($multi,$c);curl_close($c);}curl_multi_close($multi);
    return $out;
}
function assetSheet(array $v,array $cfg,array $selected=[]): array {
    if(!extension_loaded('gd'))throw new RuntimeException('Enable the PHP GD extension to create car asset sheets.');
    $base=validateAppBase($cfg);
    $all=$v['photos']??[];if(!$all)throw new RuntimeException('No photos found for this vehicle.');
    $urls=$selected?:defaultSheetPhotos($v);
    if(count($urls)>9 || count($urls)<1 || array_diff($urls,$all))throw new RuntimeException('Choose 1–9 photos from this vehicle gallery.');
    $bytes=sheetBytes($urls,$cfg);if(count($bytes)!==count($urls))throw new RuntimeException('A vehicle photo could not be downloaded. No incomplete sheet was saved; try again or choose other photos.');
    // 2 columns for up to 4 photos (front / sides / rear as a 2×2 grid), 3 columns above that.
    $cols=count($urls)<=4?2:3;$width=1800;$tileW=intdiv($width,$cols);$boxW=$tileW-30;$boxH=(int)round($boxW*0.737);
    $rows=(int)ceil(count($urls)/$cols);$height=100+$rows*($boxH+40);
    $sheet=imagecreatetruecolor($width,$height);$bg=imagecolorallocate($sheet,18,23,32);$white=imagecolorallocate($sheet,244,244,244);$gold=imagecolorallocate($sheet,239,189,100);imagefill($sheet,0,0,$bg);
    imagestring($sheet,5,24,20,title($v).' | STOCK '.($v['StockNumber']??''),$gold);
    imagestring($sheet,3,24,48,'Original inventory photos - source views only; no invented angles or features',$white);
    $hash=hash_init('sha256');
    foreach($urls as $i=>$url){
        $size=@getimagesizefromstring($bytes[$i]);if(!$size || $size[0]*$size[1]>16000000){imagedestroy($sheet);throw new RuntimeException('Invalid or excessively large source image.');}
        $img=@imagecreatefromstring($bytes[$i]);if(!$img){imagedestroy($sheet);throw new RuntimeException('Unable to decode a vehicle photo.');}
        $x=($i%$cols)*$tileW+15;$y=100+(int)floor($i/$cols)*($boxH+40); $ratio=min($boxW/imagesx($img),$boxH/imagesy($img));$w=(int)round(imagesx($img)*$ratio);$h=(int)round(imagesy($img)*$ratio);
        imagecopyresampled($sheet,$img,$x+(int)(($boxW-$w)/2),$y+(int)(($boxH-$h)/2),0,0,$w,$h,imagesx($img),imagesy($img));
        imagestring($sheet,3,$x,$y+$boxH+6,'SOURCE PHOTO '.(array_search($url,$all,true)+1),$white);hash_update($hash,$bytes[$i]);imagedestroy($img);unset($bytes[$i]);
    }
    $dir=$cfg['asset_dir']??(__DIR__.'/../public/assets');if(!is_dir($dir))mkdir($dir,0755,true);$name=bin2hex(random_bytes(20)).'.jpg';
    if(!imagejpeg($sheet,$dir.'/'.$name,92)){imagedestroy($sheet);throw new RuntimeException('Cannot save the asset sheet. Check assets directory permissions.');}imagedestroy($sheet);
    return ['url'=>$base.'/assets/'.$name,'photo_urls'=>$urls,'gallery_hash'=>hash('sha256',json_encode($all)),'content_hash'=>hash_final($hash),'created_at'=>gmdate('c'),'photo_count'=>count($urls)];
}

function validateAppBase(array $cfg):string {
    $base=rtrim((string)($cfg['public_base_url']??''),'/');$u=parse_url($base);
    if(($cfg['allow_local_http']??false)&&($u['scheme']??'')==='http'&&in_array($u['host']??'',['127.0.0.1','localhost','[::1]'],true)&&($u['port']??0)===4343&&!isset($u['user'])&&!isset($u['pass'])&&!isset($u['query'])&&!isset($u['fragment']))return $base;
    // Allow port 4343 only on the configured application origin.
    if(($u['scheme']??'')==='https'&&($u['port']??0)===4343&&!isset($u['user'])&&!isset($u['pass'])&&!isset($u['query'])&&!isset($u['fragment'])){
        publicImage('https://'.($u['host']??'').'/image.jpg');return $base;
    }
    publicImage($base.'/image.jpg');return $base;
}
function referenceImageUrl(string $url,array $cfg):string {
    $base=validateAppBase($cfg);$prefix=$base.'/assets/';
    if(str_starts_with($url,$prefix)&&preg_match('/^[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$/i',substr($url,strlen($prefix))))return $url;
    return publicImage($url);
}
