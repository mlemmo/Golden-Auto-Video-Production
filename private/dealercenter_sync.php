<?php
declare(strict_types=1);
// DealerCenter inventory tracking. Input: a snapshot of the DealerCenter active list (no costs) plus
// optional photo ZIPs named <stock>.zip. Compares with saved inventory, records a change log in state
// row "sync_log", marks vehicles missing from the snapshot inactive (kept, never deleted).
// CLI: php private/dealercenter_sync.php snapshot.json [zip-dir]
require_once __DIR__.'/app.php';

function dcNormalize(array $s):array {
    $stock=trim((string)($s['stock']??''));if(!preg_match('/^[A-Za-z0-9_-]{1,40}$/',$stock))throw new RuntimeException('Snapshot has an invalid stock number.');
    $year=filter_var($s['year']??null,FILTER_VALIDATE_INT);if(!$year||$year<1900||$year>(int)date('Y')+2)throw new RuntimeException("Stock $stock: invalid year.");
    $make=strtoupper(trim((string)($s['make']??'')));$model=strtoupper(trim((string)($s['model']??'')));
    if(!$make||!$model||strlen($make)>60||strlen($model)>100)throw new RuntimeException("Stock $stock: make and model required.");
    $vin=strtoupper(trim((string)($s['vin']??'')));if($vin&&!preg_match('/^[A-HJ-NPR-Z0-9]{17}$/',$vin))throw new RuntimeException("Stock $stock: invalid VIN.");
    $prices=[];foreach((array)($s['prices']??[])as $p){if(is_numeric($p)&&(float)$p>0)$prices[]=(float)$p;}
    $mileage=$s['mileage']??null;if($mileage!==null&&$mileage!==''&&(filter_var($mileage,FILTER_VALIDATE_INT)===false||(int)$mileage<0||(int)$mileage>2000000))throw new RuntimeException("Stock $stock: invalid mileage.");
    $photos=filter_var($s['photo_count']??null,FILTER_VALIDATE_INT);if($photos===false||$photos===null||$photos<0||$photos>100)throw new RuntimeException("Stock $stock: photo_count must be 0–100.");
    return ['stock'=>$stock,'vin'=>$vin,'year'=>$year,'make'=>$make,'model'=>$model,'trim'=>trim((string)($s['trim']??'')),
        'drivetrain'=>trim((string)($s['drivetrain']??'')),'color'=>trim((string)($s['color']??'')),
        'mileage'=>($mileage===null||$mileage==='')?null:(int)$mileage,'price'=>$prices?max($prices):null,
        'description'=>dcCleanDescription((string)($s['description']??'')),'photo_count'=>$photos];
}
/** DealerCenter descriptions open with a tax/registration price disclaimer; it never belongs in ad copy. */
function dcCleanDescription(string $s):string {
    $s=preg_replace('/Total price does not include State Sales Tax or Registration fees,?\s*please call us for the total price\.?/iu','',$s)??$s;
    return mbSafeText(preg_replace("/^\s+/u",'',$s)??$s);
}
/** Saved JSON turns 9000.0 into 9000, so compare prices by value. */
function dcSamePrice(mixed $a,mixed $b):bool {return $a===null||$b===null?$a===$b:abs((float)$a-(float)$b)<0.005;}
/** Local imported photo files (40-hex .jpg in assets) referenced by a vehicle. */
function dcLocalPhotos(array $v,array $cfg):array {
    $out=[];foreach($v['photos']??[]as $url){$name=basename((string)parse_url((string)$url,PHP_URL_PATH));if(preg_match('/^[a-f0-9]{40}\.jpg$/',$name))$out[]=($cfg['asset_dir']??__DIR__.'/../public/assets').'/'.$name;}
    return $out;
}
function dcApplyFields(array $v,array $s):array {
    $v['Vin']=$s['vin']?:($v['Vin']??'stock:'.$s['stock']);$v['Year']=$s['year'];$v['Make']=$s['make'];$v['Model']=$s['model'];$v['Trim']=$s['trim'];
    $v['Drivetrain']=$s['drivetrain'];$v['ExteriorColor']=$s['color'];$v['Odometer']=$s['mileage'];$v['VehiclePrice']=$s['price']??0;$v['price']=$s['price'];
    if($s['description']!=='')$v['description']=$s['description'];
    $v['feed']='dealercenter';$v['active']=true;unset($v['removed_at']);$v['dc_checked_at']=gmdate('c');return $v;
}
function dcSync(PDO $db,array $cfg,array $snapshot,?string $zipDir=null):array {
    if(!array_is_list($snapshot)||!$snapshot)throw new RuntimeException('Snapshot must be a non-empty list of vehicles.');
    $items=[];foreach($snapshot as $raw){$s=dcNormalize((array)$raw);if(isset($items[$s['stock']]))throw new RuntimeException('Duplicate stock '.$s['stock'].' in snapshot.');$items[$s['stock']]=$s;}
    $before=[];foreach(state($db,'inventory')['vehicles']??[]as $v)$before[$v['StockNumber']]=$v;

    // Phase 1 (no DB lock): import ZIPs for vehicles that are new or whose photo count changed.
    $imported=[];$created=[];
    try{
        foreach($items as $stock=>$s){
            $cur=$before[$stock]??null;
            if($cur&&!empty($cur['photos'])&&($cur['dc_photo_count']??null)===$s['photo_count'])continue;
            $zip=$zipDir?rtrim($zipDir,'/').'/'.$stock.'.zip':null;
            if(!$zip||!is_file($zip))continue;
            $v=importMediaZip($zip,['stock'=>$stock,'year'=>$s['year'],'make'=>$s['make'],'model'=>$s['model'],'trim'=>$s['trim'],'vin'=>$s['vin'],
                'mileage'=>$s['mileage']===null?'':(string)$s['mileage'],'prices'=>$s['price']===null?'':(string)$s['price'],'description'=>$s['description'],'drivetrain'=>$s['drivetrain']],$cfg);
            $created=array_merge($created,dcLocalPhotos($v,$cfg));
            $v['dc_photo_count']=$s['photo_count'];$imported[$stock]=$v;
        }
    }catch(Throwable $e){foreach($created as $f)@unlink($f);throw $e;}

    // Phase 2 (short transaction): re-read inventory and apply all changes.
    $log=['at'=>gmdate('c'),'source'=>'dealercenter','active_count'=>count($items),'added'=>[],'photos_updated'=>[],'price_changed'=>[],'updated'=>[],'returned'=>[],'removed'=>[],'waiting_photos'=>[]];
    $stale=[];
    $db->beginTransaction();
    try{
        $inv=state($db,'inventory')??['vehicles'=>[]];$byStock=[];foreach($inv['vehicles']as $v)$byStock[$v['StockNumber']]=$v;
        foreach($items as $stock=>$s){
            $cur=$byStock[$stock]??null;$label=$stock.' '.trim($s['year'].' '.$s['make'].' '.$s['model']);
            if(isset($imported[$stock])){
                $v=dcApplyFields($imported[$stock],$s);$v['imported_at']=$imported[$stock]['imported_at'];
                if($cur){$stale=array_merge($stale,array_diff(dcLocalPhotos($cur,$cfg),dcLocalPhotos($v,$cfg)));$log['photos_updated'][]=$label.' ('.count($v['photos']).' photos)';}
                else $log['added'][]=$label.' ('.count($v['photos']).' photos)';
            }elseif($cur){
                $v=dcApplyFields($cur,$s);
                if(($cur['dc_photo_count']??null)!==$s['photo_count']||empty($cur['photos']))$log['waiting_photos'][]=$label.' (photo count '.($cur['dc_photo_count']??'unknown').' → '.$s['photo_count'].')';
            }else{$log['waiting_photos'][]=$label.' (new, '.$s['photo_count'].' photos)';continue;}
            if($cur){
                if(!dcSamePrice($cur['price']??null,$v['price'])){$log['price_changed'][]=$label.': '.money($cur['price']).' → '.money($v['price']);$v['price_changed_at']=gmdate('c');}
                if(($cur['active']??true)===false)$log['returned'][]=$label;
                elseif(!isset($imported[$stock])&&(($cur['Odometer']??null)!==$v['Odometer']||($cur['description']??'')!==($v['description']??'')||($cur['Trim']??'')!==$v['Trim']))$log['updated'][]=$label;
            }
            $byStock[$stock]=$v;
        }
        foreach($byStock as $stock=>$v){
            if(isset($items[$stock])||($v['source']??'')!=='zip'||($v['active']??true)===false)continue;
            $v['active']=false;$v['removed_at']=gmdate('c');$byStock[$stock]=$v;$log['removed'][]=$stock.' '.title($v);
        }
        $inv['vehicles']=array_values($byStock);$inv['dealercenter_checked_at']=gmdate('c');save($db,'inventory',$inv);
        foreach($imported as $stock=>$_)save($db,'import:'.$stock,$byStock[$stock]);
        $history=state($db,'sync_log')??['entries'=>[]];array_unshift($history['entries'],$log);$history['entries']=array_slice($history['entries'],0,30);save($db,'sync_log',$history);
        $db->commit();
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();foreach($created as $f)@unlink($f);throw $e;}
    foreach($stale as $f)if(is_file($f))@unlink($f);
    // Asset sheets for new photo sets; a failure here leaves the vehicle usable (the dashboard rebuilds on open).
    foreach($imported as $stock=>$_){$v=$byStock[$stock];try{save($db,'sheet:'.$v['Vin'],assetSheet($v,$cfg));}catch(Throwable $e){$log['sheet_errors'][]=$stock.': '.$e->getMessage();}}
    return $log;
}

if(PHP_SAPI==='cli'&&realpath($_SERVER['SCRIPT_FILENAME']??'')===__FILE__){
    if($argc<2){fwrite(STDERR,"usage: php dealercenter_sync.php snapshot.json [zip-dir]\n");exit(2);}
    $cfg=require __DIR__.'/config.php';$cfg['asset_dir']=$cfg['asset_dir']??__DIR__.'/../public/assets';
    $snapshot=json_decode((string)file_get_contents($argv[1]),true,512,JSON_THROW_ON_ERROR);
    echo json_encode(dcSync(db($cfg),$cfg,$snapshot,$argv[2]??null),JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE),"\n";
}
