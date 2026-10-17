<?php
declare(strict_types=1);
// Clients (dealers): each has its own inventory. Golden Auto is the first client and keeps the original
// 'inventory' state; other clients use 'inventory:<id>'. Adding a client analyses its website and recommends how
// to import its inventory.
const CLIENT_DEFAULT='golden-auto';

function clientsLoad(PDO $db):array {
    $c=state($db,'clients');
    if(!$c||empty($c['items'])){
        $c=['items'=>[['id'=>CLIENT_DEFAULT,'name'=>'Golden Auto','website'=>'https://www.mygoldenauto.net','created_at'=>gmdate('c'),
            'analysis'=>['platform'=>'DealerCenter','best'=>'dealercenter_snapshot','note'=>'Existing setup: DealerCenter website snapshot (browser) and DealerCenter photos.']]]];
        save($db,'clients',$c);
    }
    return $c;
}
function clientFind(PDO $db,string $id):array {
    foreach(clientsLoad($db)['items'] as $c)if($c['id']===$id)return $c;
    throw new RuntimeException('Client not found.');
}
/** Inventory state key for a client; Golden Auto keeps the original key so existing data and tools keep working. */
function clientInventoryKey(string $client):string {
    if($client===CLIENT_DEFAULT||$client==='')return 'inventory';
    if(!preg_match('/^[a-z0-9-]{1,40}$/',$client))throw new RuntimeException('Invalid client.');
    return 'inventory:'.$client;
}
function clientInventory(PDO $db,string $client):array {return state($db,clientInventoryKey($client))??['vehicles'=>[]];}

/** Validates and normalises a website address to its https origin. */
function clientWebsite(string $url):string {
    $url=trim($url);if($url!==''&&!preg_match('~^https?://~i',$url))$url='https://'.$url;
    $p=parse_url($url);$host=strtolower($p['host']??'');
    if(!in_array(strtolower($p['scheme']??''),['http','https'],true)||!preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/',$host)||isset($p['user'])||isset($p['pass'])||isset($p['port']))
        throw new RuntimeException('Enter the dealer website, e.g. www.example.com.');
    if(preg_match('/(?:^|\.)(localhost|local|internal)$/',$host))throw new RuntimeException('Enter a public website.');
    return 'https://'.$host;
}

function clientAdd(PDO $db,string $name,string $website,?callable $fetch=null):array {
    $name=trim(preg_replace('/\s+/',' ',$name));if($name===''||strlen($name)>80)throw new RuntimeException('Enter the client name (up to 80 characters).');
    $website=clientWebsite($website);
    $c=clientsLoad($db);
    foreach($c['items'] as $x){
        if(strcasecmp($x['name'],$name)===0)throw new RuntimeException('A client with this name already exists; select it from the list.');
        if(parse_url($x['website'],PHP_URL_HOST)===parse_url($website,PHP_URL_HOST))throw new RuntimeException('This website already belongs to client “'.$x['name'].'”.');
    }
    $base=trim(preg_replace('/[^a-z0-9]+/','-',strtolower($name)),'-')?:'client';$base=substr($base,0,32);$id=$base;$n=2;
    $ids=array_column($c['items'],'id');while(in_array($id,$ids,true))$id=$base.'-'.$n++;
    $client=['id'=>$id,'name'=>$name,'website'=>$website,'created_at'=>gmdate('c')];
    $client['analysis']=clientAnalyze($website,$fetch);
    $c['items'][]=$client;save($db,'clients',$c);
    return $client;
}
function clientReanalyze(PDO $db,string $id,?callable $fetch=null):array {
    $c=clientsLoad($db);
    foreach($c['items'] as &$x)if($x['id']===$id){$x['analysis']=clientAnalyze($x['website'],$fetch);save($db,'clients',$c);return $x;}
    throw new RuntimeException('Client not found.');
}

/**
 * Fetch a public https page: no redirects to other schemes, private addresses or other ports; 3 MB cap.
 * Returns ['code','body','url','headers'] (code 0 when unreachable).
 */
function clientFetch(string $url,int $redirects=3):array {
    for($i=0;$i<=$redirects;$i++){
        $p=parse_url($url);$host=strtolower($p['host']??'');
        if(($p['scheme']??'')!=='https'||$host===''||isset($p['port'])||isset($p['user']))return ['code'=>0,'body'=>'','url'=>$url,'headers'=>''];
        $ip=null;foreach(gethostbynamel($host)?:[] as $cand)if(filter_var($cand,FILTER_VALIDATE_IP,FILTER_FLAG_NO_PRIV_RANGE|FILTER_FLAG_NO_RES_RANGE)){$ip=$cand;break;}
        if(!$ip)return ['code'=>0,'body'=>'','url'=>$url,'headers'=>''];
        $headers='';$body='';
        $c=curl_init($url);
        curl_setopt_array($c,[CURLOPT_RESOLVE=>[$host.':443:'.$ip],CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>20,
            CURLOPT_HTTPHEADER=>['Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8','User-Agent: Mozilla/5.0 (compatible; GoldenAutoVideoStudio/1.0; inventory check)'],
            CURLOPT_HEADERFUNCTION=>function($ch,$h)use(&$headers){$headers.=$h;return strlen($h);},
            CURLOPT_WRITEFUNCTION=>function($ch,$d)use(&$body){$body.=$d;return strlen($body)>3000000?0:strlen($d);}]);
        curl_exec($c);$code=(int)curl_getinfo($c,CURLINFO_RESPONSE_CODE);$loc=(string)curl_getinfo($c,CURLINFO_REDIRECT_URL);curl_close($c);
        if($code>=300&&$code<400&&$loc!==''){$url=$loc;continue;}
        return ['code'=>$code,'body'=>$body,'url'=>$url,'headers'=>$headers];
    }
    return ['code'=>0,'body'=>'','url'=>$url,'headers'=>''];
}

const CLIENT_PLATFORMS=[
    'DealerCenter'=>['dealercenter','inv-scripts-v2','dws_inventory'],
    'Dealer.com (Cox Automotive)'=>['pictures.dealer.com','ddc-site','dealer.com/','ws-inv-data'],
    'Dealer Inspire'=>['dealerinspire','dealer inspire'],
    'DealerOn'=>['dealeron'],
    'DealerFire / DealerSocket'=>['dealerfire','dealersocket'],
    'Dealer eProcess'=>['dealereprocess'],
    'CDK Global / Sincro'=>['cdkglobal','cobaltgroup','sincro'],
    'Carsforsale.com'=>['carsforsale.com'],
    'Dealer Car Search'=>['dealercarsearch'],
    'Frazer'=>['frazerweb','frazer.com'],
    'Dealer Spike'=>['dealerspike'],
    'Overfuel'=>['overfuel'],
    'AutoManager'=>['automanager'],
];
/** Platforms whose dealers can usually turn on a daily inventory feed (CSV/XML by FTP) to a third party. */
const CLIENT_FEED_PLATFORMS=['DealerCenter','Dealer.com (Cox Automotive)','Dealer Inspire','DealerOn','DealerFire / DealerSocket','Dealer eProcess','CDK Global / Sincro','Carsforsale.com','Dealer Car Search','Frazer','Dealer Spike','Overfuel','AutoManager'];

/**
 * Look at a dealer website and recommend how to import its inventory. Free: a few public page requests.
 * $fetch(url) → ['code','body','url','headers'] is replaceable in tests.
 */
function clientAnalyze(string $website,?callable $fetch=null):array {
    $fetch??='clientFetch';
    $home=$fetch($website);$html=strtolower((string)$home['body']);$hdr=strtolower((string)$home['headers']);
    $blocked=$home['code']===403||$home['code']===503&&str_contains($hdr,'cloudflare')||str_contains($html,'cf-chl')||str_contains($html,'just a moment...')||str_contains($html,'attention required! | cloudflare');
    $reachable=$home['code']>=200&&$home['code']<300&&!$blocked;
    $signals=[];$platform=null;
    if($reachable)foreach(CLIENT_PLATFORMS as $name=>$marks)foreach($marks as $m)if(str_contains($html,$m)){$platform=$name;$signals[]='Website code mentions “'.$m.'” → '.$name;break 2;}
    // schema.org data: the dealer's own details and vehicle listings.
    $dealer=null;$vehiclesLd=0;
    if($reachable&&preg_match_all('~<script[^>]+application/ld\+json[^>]*>(.*?)</script>~is',(string)$home['body'],$m))foreach($m[1] as $json){
        $d=json_decode(html_entity_decode(trim($json)),true);if(!is_array($d))continue;
        $nodes=isset($d['@graph'])&&is_array($d['@graph'])?$d['@graph']:(array_is_list($d)?$d:[$d]);
        foreach($nodes as $n){if(!is_array($n))continue;$t=(array)($n['@type']??[]);
            if(array_intersect($t,['AutoDealer','AutomotiveBusiness','LocalBusiness'])&&!$dealer)$dealer=array_filter(['name'=>$n['name']??null,'telephone'=>$n['telephone']??null,
                'city'=>$n['address']['addressLocality']??null,'state'=>$n['address']['addressRegion']??null,'street'=>$n['address']['streetAddress']??null],'is_string');
            if(array_intersect($t,['Car','Vehicle','Product']))$vehiclesLd++;}
    }
    if($dealer)$signals[]='Dealer details published on the site: '.implode(', ',$dealer);
    if($vehiclesLd)$signals[]=$vehiclesLd.' vehicle listing(s) published as structured data on the home page';
    // Sitemap: how many vehicle pages the site lists.
    $vdp=0;$sitemap=null;
    if($reachable){
        $robots=$fetch($website.'/robots.txt');
        if(preg_match('/^sitemap:\s*(\S+)/im',(string)$robots['body'],$sm))$sitemap=$sm[1];
        $s=$fetch($sitemap&&str_starts_with($sitemap,$website)?$sitemap:$website.'/sitemap.xml');
        if($s['code']===200){$sitemap=$s['url'];$vdp=preg_match_all('~<loc>[^<]*(?:/inventory/|/vehicle|/vdp|/used/|/details/)[^<]*</loc>~i',(string)$s['body']);
            if($vdp)$signals[]='Sitemap lists '.$vdp.' vehicle page(s)';}
    }
    if($blocked)$signals[]='The website blocks automated requests from this server (bot protection), like mygoldenauto.net does';
    elseif(!$reachable)$signals[]='The website could not be reached (HTTP '.$home['code'].')';

    $options=[];
    if($platform&&in_array($platform,CLIENT_FEED_PLATFORMS,true))$options[]=['method'=>'feed','title'=>'Daily inventory feed from '.$platform,
        'why'=>$platform.' can send the dealer’s inventory (vehicles, prices, photos) as a daily CSV/XML file by FTP. Most reliable: no website reading, includes cars not yet online.',
        'effort'=>'The dealer asks '.$platform.' support to add a feed to us; we add the reader once we have a sample file.'];
    if($platform==='DealerCenter'&&$reachable)$options[]=['method'=>'website_dealercenter','title'=>'Website reader (same as Golden Auto)',
        'why'=>'The site runs on DealerCenter’s website platform, which the studio already reads.','effort'=>'Works now: set as the import method and refresh inventory.'];
    if($reachable&&($vehiclesLd||$vdp))$options[]=['method'=>'website_structured','title'=>'Website import from listing pages',
        'why'=>'The site publishes its vehicles'.($vdp?' in its sitemap ('.$vdp.' pages)':'').($vehiclesLd?' with structured listing data':'').', which can be read without dealer setup.',
        'effort'=>$platform==='Dealer Car Search'?'Ready: use “Import inventory from website” in step 1 (free; reads each listing page and copies 8 photos per car).':'We build a reader for this site’s listing pages (free to run); breaks if the site layout changes.'];
    if($blocked||!$reachable)$options[]=['method'=>'browser_snapshot','title'=>'Browser snapshot (as Golden Auto today)',
        'why'=>'The site '.($blocked?'blocks':'does not answer').' this server, but it can be read in a normal browser and the snapshot fed in.','effort'=>'Manual or scheduled run in Chrome; photos are downloaded by the server.'];
    $options[]=['method'=>'zip','title'=>'Manual import (form + photo ZIP)','why'=>'Works for any dealer and for cars not online yet.','effort'=>'Per car, by hand. Fine for a few cars.'];
    return ['checked_at'=>gmdate('c'),'reachable'=>$reachable,'blocked'=>$blocked,'platform'=>$platform,'dealer'=>$dealer,'sitemap'=>$sitemap,
        'vehicle_pages'=>$vdp,'signals'=>$signals,'options'=>$options,'best'=>$options[0]['method']];
}
