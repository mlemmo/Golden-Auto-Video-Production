<?php
declare(strict_types=1);
// Saved spokesperson library: images live in public/assets, metadata in state row "spokespersons".

function spokespersonDir(array $cfg):string {return $cfg['asset_dir']??(__DIR__.'/../public/assets');}
function spokespersonLibrary(PDO $db,array $cfg):array {
    $lib=state($db,'spokespersons');
    if($lib===null){
        // First run: register the original single spokesperson image so nothing is lost.
        $lib=['items'=>[],'default'=>null];
        foreach(['spokesperson.png','spokesperson.jpg','spokesperson.jpeg','spokesperson.webp'] as $legacy)if(is_file(spokespersonDir($cfg).'/'.$legacy)){
            $id=bin2hex(random_bytes(8));$lib['items'][]=['id'=>$id,'name'=>'Original spokesperson','description'=>SPOKESPERSON_DEFAULT_DESCRIPTION,'file'=>$legacy,'created_at'=>gmdate('c')];$lib['default']=$id;break;
        }
        save($db,'spokespersons',$lib);
    }
    return $lib;
}
function spokespersonPublic(array $item,array $cfg):array {return $item+['url'=>rtrim((string)($cfg['public_base_url']??''),'/').'/assets/'.$item['file']];}
function spokespersonFind(PDO $db,array $cfg,string $id):array {
    foreach(spokespersonLibrary($db,$cfg)['items'] as $item)if($item['id']===$id)return spokespersonPublic($item,$cfg);
    throw new RuntimeException('Choose a spokesperson. Upload one under Spokespersons if the list is empty.');
}
function spokespersonClean(string $s,int $max,string $field):string {
    $s=trim(preg_replace('/\s+/u',' ',$s)??'');
    if($s==='')throw new RuntimeException('Enter the spokesperson '.$field.'.');
    if(!preg_match('//u',$s)||preg_match_all('/./us',$s)>$max)throw new RuntimeException('Spokesperson '.$field.' must be at most '.$max.' characters.');
    if(str_contains($s,'"'))throw new RuntimeException('Do not use double quotes in the spokesperson '.$field.'.');
    return $s;
}
function spokespersonApi(string $action,array $in,array $cfg,PDO $db):array {
    $lib=spokespersonLibrary($db,$cfg);
    if($action==='spokesperson_list'){}
    elseif($action==='spokesperson_upload'){
        $name=spokespersonClean((string)($in['name']??''),60,'name');$description=spokespersonClean((string)($in['description']??''),300,'description');
        $file=$_FILES['image']??null;
        if(!$file||$file['error']!==UPLOAD_ERR_OK||!is_uploaded_file($file['tmp_name']))throw new RuntimeException('Image upload failed. Check upload_max_filesize and post_max_size in PHP settings.');
        if($file['size']>20000000)throw new RuntimeException('Spokesperson image must be 20 MB or smaller.');
        $size=@getimagesize($file['tmp_name']);$ext=['image/jpeg'=>'jpg','image/png'=>'png','image/webp'=>'webp'][$size['mime']??'']??null;
        if(!$size||!$ext)throw new RuntimeException('Upload a JPG, PNG or WebP image.');
        if($size[0]*$size[1]>16000000)throw new RuntimeException('Spokesperson image is too large to decode; keep it under 16 megapixels.');
        if($size[0]<300||$size[1]<300)throw new RuntimeException('Spokesperson image must be at least 300×300 pixels.');
        $dir=spokespersonDir($cfg);if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Cannot create assets folder.');
        $id=bin2hex(random_bytes(8));$stored='spokesperson-'.$id.'.'.$ext;
        if(!move_uploaded_file($file['tmp_name'],$dir.'/'.$stored))throw new RuntimeException('Could not save the spokesperson image.');
        chmod($dir.'/'.$stored,0644);
        $lib['items'][]=['id'=>$id,'name'=>$name,'description'=>$description,'file'=>$stored,'created_at'=>gmdate('c')];
        $lib['default']??=$id;save($db,'spokespersons',$lib);
    }
    elseif($action==='spokesperson_default'){
        $id=(string)($in['id']??'');spokespersonFind($db,$cfg,$id);$lib['default']=$id;save($db,'spokespersons',$lib);
    }
    elseif($action==='spokesperson_delete'){
        $id=(string)($in['id']??'');$item=spokespersonFind($db,$cfg,$id);
        $lib['items']=array_values(array_filter($lib['items'],fn($i)=>$i['id']!==$id));
        if($lib['default']===$id)$lib['default']=$lib['items'][0]['id']??null;
        save($db,'spokespersons',$lib);
        // Only uploaded files are removed; the original spokesperson.* stays on disk.
        if(str_starts_with($item['file'],'spokesperson-')&&is_file(spokespersonDir($cfg).'/'.$item['file']))unlink(spokespersonDir($cfg).'/'.$item['file']);
    }
    else throw new RuntimeException('Unknown action.');
    return ['items'=>array_map(fn($i)=>spokespersonPublic($i,$cfg),$lib['items']),'default'=>$lib['default']];
}
