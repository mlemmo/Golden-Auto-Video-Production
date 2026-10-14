<?php
declare(strict_types=1);
function importMediaZip(string $path,array $fields,array $cfg):array {
    if(!class_exists('ZipArchive')||!extension_loaded('gd'))throw new RuntimeException('Enable PHP Zip and GD extensions.');
    $stock=trim((string)($fields['stock']??''));if(!preg_match('/^[A-Za-z0-9_-]{1,40}$/',$stock))throw new RuntimeException('Enter a valid stock number.');
    $year=filter_var($fields['year']??null,FILTER_VALIDATE_INT);if(!$year||$year<1900||$year>(int)date('Y')+2)throw new RuntimeException('Enter the vehicle year.');
    $make=trim((string)($fields['make']??''));$model=trim((string)($fields['model']??''));if(!$make||!$model||strlen($make)>60||strlen($model)>100)throw new RuntimeException('Enter make and model.');
    $vin=strtoupper(trim((string)($fields['vin']??'')));if($vin && !preg_match('/^[A-HJ-NPR-Z0-9]{17}$/',$vin))throw new RuntimeException('VIN must be 17 characters or left blank.');
    $prices=[];foreach(explode(';',(string)($fields['prices']??''))as $s){$s=trim(str_replace(['$',','],'',$s));if($s==='')continue;if(!is_numeric($s)||(float)$s<=0)throw new RuntimeException('Enter positive advertised prices, separated by semicolons.');$prices[]=(float)$s;}
    $mile=trim((string)($fields['mileage']??''));if($mile!==''&&(!ctype_digit($mile)||(int)$mile>2000000))throw new RuntimeException('Mileage must be digits or blank.');
    $description=mbSafeText((string)($fields['description']??''));
    $base=validateAppBase($cfg);
    if(!is_file($path)||filesize($path)>50000000)throw new RuntimeException('ZIP must be under 50 MB.');
    $zip=new ZipArchive();if($zip->open($path)!==true)throw new RuntimeException('Cannot open ZIP.');
    $entries=[];$total=0;
    try{
        if($zip->numFiles>150)throw new RuntimeException('ZIP has too many entries.');
        for($i=0;$i<$zip->numFiles;$i++){
            $st=$zip->statIndex($i);$name=$st['name'];
            if(str_contains($name,'..')||str_starts_with($name,'/')||str_contains($name,'\\'))throw new RuntimeException('Invalid ZIP paths.');
            if(str_ends_with($name,'/')||str_starts_with($name,'__MACOSX/'))continue;
            if(!preg_match('/\.(jpg|jpeg|png|webp)$/i',$name))continue;
            $size=$st['size'];$total+=$size;if($size>10000000||$total>200000000)throw new RuntimeException('ZIP image data is too large.');
            $entries[]=['index'=>$i,'name'=>$name];
        }
        if(!$entries||count($entries)>100)throw new RuntimeException('ZIP must contain 1–100 supported images.');
        usort($entries,fn($a,$b)=>strnatcasecmp($a['name'],$b['name']));
        $dir=$cfg['asset_dir']??(__DIR__.'/../public/assets');if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Cannot create assets folder.');
        $created=[];$photos=[];$originals=[];
        try{
            foreach($entries as $entry){
                $bytes=$zip->getFromIndex($entry['index']);$size=$bytes===false?false:@getimagesizefromstring($bytes);
                if(!$size||$size[0]*$size[1]>16000000)throw new RuntimeException('Invalid or oversized image in ZIP.');
                $img=@imagecreatefromstring($bytes);if(!$img)throw new RuntimeException('Unsupported image in ZIP.');
                $ratio=min(1,1600/imagesx($img),1600/imagesy($img));$w=(int)round(imagesx($img)*$ratio);$h=(int)round(imagesy($img)*$ratio);
                $clean=imagecreatetruecolor($w,$h);imagefill($clean,0,0,imagecolorallocate($clean,255,255,255));imagecopyresampled($clean,$img,0,0,0,0,$w,$h,imagesx($img),imagesy($img));imagedestroy($img);
                $name=bin2hex(random_bytes(20)).'.jpg';$local=$dir.'/'.$name;$created[]=$local;
                $ok=imagejpeg($clean,$local,92);imagedestroy($clean);if(!$ok)throw new RuntimeException('Cannot save imported photo.');
                $photos[]=$base.'/assets/'.$name;$originals[]=$entry['name'];
            }
        }catch(Throwable $e){foreach($created as $f)@unlink($f);throw $e;}
    }finally{$zip->close();}
    return ['source'=>'zip','StockNumber'=>$stock,'Vin'=>$vin?:'stock:'.$stock,'Year'=>$year,'Make'=>strtoupper($make),'Model'=>strtoupper($model),'Trim'=>trim((string)($fields['trim']??'')),'Drivetrain'=>trim((string)($fields['drivetrain']??'')),'ExteriorColor'=>'','Odometer'=>$mile===''?null:(int)$mile,'VehiclePrice'=>$prices?max($prices):0,'price'=>$prices?max($prices):null,'description'=>$description,'photos'=>$photos,'original_filenames'=>$originals,'imported_at'=>gmdate('c'),'url'=>'','detail_checked_at'=>gmdate('c')];
}
function mbSafeText(string $s):string {if(strlen($s)>20000)throw new RuntimeException('Description is too long.');return trim(strip_tags($s));}
function sheetBytes(array $urls,array $cfg):array {
    $base=rtrim((string)($cfg['public_base_url']??''),'/').'/assets/';$local=[];$remote=[];
    foreach($urls as $i=>$url){if(str_starts_with($url,$base)&&preg_match('/^[a-f0-9]{40}\.jpg$/',substr($url,strlen($base)))){
        $file=($cfg['asset_dir']??(__DIR__.'/../public/assets')).'/'.substr($url,strlen($base));
        if(!is_file($file)||filesize($file)>10000000)throw new RuntimeException('Imported photo is missing or too large.');$local[$i]=file_get_contents($file);
    }else{$remote[$i]=$url;}}
    if($remote){$keys=array_keys($remote);foreach(downloadPhotos(array_values($remote))as $i=>$bytes)$local[$keys[$i]]=$bytes;}
    return $local;
}
