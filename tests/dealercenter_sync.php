<?php
declare(strict_types=1);
require __DIR__.'/../private/dealercenter_sync.php';
function verify(bool $ok,string $name):void{if(!$ok)throw new RuntimeException('FAIL '.$name);echo "PASS $name\n";}
$dir=sys_get_temp_dir().'/ga-dcsync-'.bin2hex(random_bytes(4));foreach(['assets','data','zips'] as $d)mkdir("$dir/$d",0700,true);
$cfg=['asset_dir'=>"$dir/assets",'data_dir'=>"$dir/data",'public_base_url'=>'https://example.com:4343'];
function makeZip(string $path,int $count):void{$z=new ZipArchive();$z->open($path,ZipArchive::CREATE|ZipArchive::OVERWRITE);for($i=1;$i<=$count;$i++){$im=imagecreatetruecolor(40,30);imagefill($im,0,0,imagecolorallocate($im,20*$i,90,160));ob_start();imagejpeg($im);$z->addFromString("IMG_$i.jpg",ob_get_clean());imagedestroy($im);}$z->close();}
function car(string $stock,int $photos,float $price,array $extra=[]):array{return $extra+['stock'=>$stock,'vin'=>'','year'=>2015,'make'=>'Honda','model'=>'CR-V','trim'=>'EX-L','color'=>'Blue','mileage'=>100000,'prices'=>[$price,0],'description'=>'Clean.','photo_count'=>$photos];}
$byStock=fn(PDO $db)=>array_column(state($db,'inventory')['vehicles'],null,'StockNumber');
try{
    $db=db($cfg);
    save($db,'inventory',['vehicles'=>[['source'=>'zip','StockNumber'=>'OLD1','Vin'=>'stock:OLD1','Year'=>2010,'Make'=>'FORD','Model'=>'FOCUS','price'=>5000.0,'photos'=>[]]]]);
    makeZip("$dir/zips/S1.zip",3);
    $log=dcSync($db,$cfg,[car('S1',3,9000),car('S2',5,12000)],"$dir/zips");
    $inv=$byStock($db);
    verify(count($log['added'])===1&&str_starts_with($log['added'][0],'S1 2015 HONDA CR-V'),'new vehicle with ZIP added');
    verify(count($inv['S1']['photos'])===3&&$inv['S1']['dc_photo_count']===3&&$inv['S1']['feed']==='dealercenter'&&$inv['S1']['active']===true,'photos imported and tracked');
    verify((float)$inv['S1']['price']===9000.0,'highest positive price used');
    verify(dcSamePrice(9000,9000.0)&&!dcSamePrice(9000,8999)&&dcSamePrice(null,null)&&!dcSamePrice(null,0),'price comparison survives JSON int/float');
    verify(!isset($inv['S2'])&&count($log['waiting_photos'])===1,'new vehicle without ZIP waits for photos');
    verify($inv['OLD1']['active']===false&&isset($inv['OLD1']['removed_at'])&&count($log['removed'])===1,'missing vehicle marked inactive, not deleted');
    verify(count(state($db,'sync_log')['entries'])===1,'change log saved');

    $oldFiles=dcLocalPhotos($inv['S1'],$cfg);
    $log=dcSync($db,$cfg,[car('S1',3,8500)],"$dir/zips");$inv=$byStock($db);
    verify($log['price_changed']===['S1 2015 HONDA CR-V: $9,000 → $8,500']&&isset($inv['S1']['price_changed_at']),'price change logged');
    verify($log['photos_updated']===[]&&dcLocalPhotos($inv['S1'],$cfg)===$oldFiles,'unchanged photo count is not re-imported');
    verify($log['removed']===[],'already-inactive vehicle not removed twice');

    makeZip("$dir/zips/S1.zip",4);
    $log=dcSync($db,$cfg,[car('S1',4,8500,['mileage'=>100500])],"$dir/zips");$inv=$byStock($db);
    verify(count($log['photos_updated'])===1&&count($inv['S1']['photos'])===4,'changed photo count re-imports ZIP');
    verify(!array_filter($oldFiles,'is_file'),'replaced photo files deleted');
    verify($inv['S1']['Odometer']===100500,'mileage updated');

    $log=dcSync($db,$cfg,[car('S1',4,8500,['mileage'=>100500]),car('OLD1',2,5000,['make'=>'Ford','model'=>'Focus','year'=>2010])],"$dir/zips");$inv=$byStock($db);
    verify($log['returned']===['OLD1 2010 FORD FOCUS']&&$inv['OLD1']['active']===true&&count($log['waiting_photos'])===1,'returning vehicle reactivated and waits for photos');
    $jpg=function(int $i){$im=imagecreatetruecolor(40,30);imagefill($im,0,0,imagecolorallocate($im,10*$i,40,90));ob_start();imagejpeg($im);imagedestroy($im);return ob_get_clean();};
    $calls=[];$fake=function(array $urls)use($jpg,&$calls){$calls[]=$urls;$out=[];foreach($urls as $i=>$u)$out[$i]=$jpg($i);return $out;};
    $cdn=fn(string ...$ids)=>array_map(fn($id)=>"https://imagescf.dealercenter.net/640/480/202512-aa/$id.jpg",$ids);
    $s3=car('S3',0,11000,['photo_urls'=>$cdn('p1','p2','p3')]);unset($s3['photo_count']);
    $log=dcSync($db,$cfg,[car('S1',4,8500,['mileage'=>100500]),car('OLD1',2,5000,['make'=>'Ford','model'=>'Focus','year'=>2010]),$s3],null,$fake);$inv=$byStock($db);
    verify(count($inv['S3']['photos'])===3&&$inv['S3']['dc_photo_count']===3&&count($log['added'])===1,'photos downloaded from CDN URLs and imported');
    verify(str_contains($calls[0][0],'/1600/1200/202512-aa/p1.jpg'),'CDN photos requested at full size');
    $calls=[];dcSync($db,$cfg,[car('S1',4,8500,['mileage'=>100500]),car('OLD1',2,5000,['make'=>'Ford','model'=>'Focus','year'=>2010]),$s3],null,$fake);
    verify($calls===[],'same photo URLs are not downloaded again');
    $s3['photo_urls']=$cdn('p1','p2','p9');
    $log=dcSync($db,$cfg,[car('S1',4,8500,['mileage'=>100500]),car('OLD1',2,5000,['make'=>'Ford','model'=>'Focus','year'=>2010]),$s3],null,$fake);
    verify(count($log['photos_updated'])===1,'replaced photo with the same count is detected');
    $flaky=function(array $urls)use($jpg){$out=[];foreach($urls as $i=>$u)if($i!==1)$out[$i]=$jpg($i);return $out;};
    $s3['photo_urls']=$cdn('p1','p2','p8');
    try{dcSync($db,$cfg,[$s3],null,$flaky);verify(false,'incomplete download rejected');}catch(RuntimeException $e){verify(str_contains($e->getMessage(),'could not be downloaded')&&$byStock($db)['S1']['active']===true,'incomplete download stops the sync without changes');}
    try{dcSync($db,$cfg,[car('S4',0,1,['photo_urls'=>['https://evil.example/p.jpg']])],null,$fake);verify(false,'non-CDN photo rejected');}catch(RuntimeException $e){verify(str_contains($e->getMessage(),'imagescf'),'only DealerCenter CDN photo URLs accepted');}
    verify(dcCleanDescription("Total price does not include State Sales Tax or Registration fees, please call us for the total price.\n\nDiscover the car.")==='Discover the car.','price disclaimer removed from descriptions');
    try{dcSync($db,$cfg,[car('S1',4,8500),car('S1',4,8500)]);verify(false,'duplicate stock rejected');}catch(RuntimeException $e){verify(str_contains($e->getMessage(),'Duplicate'),'duplicate stock rejected');}
    try{dcSync($db,$cfg,[car('S1',4,8500,['vin'=>'BADVIN'])]);verify(false,'bad VIN rejected');}catch(RuntimeException $e){verify(true,'bad VIN rejected before any change');}
}finally{
    foreach(glob("$dir/*/*") as $f)unlink($f);foreach(['assets','data','zips'] as $d)rmdir("$dir/$d");rmdir($dir);
}
