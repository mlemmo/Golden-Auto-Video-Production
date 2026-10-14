<?php
declare(strict_types=1);
$private=is_file(__DIR__.'/../private/app.php')?__DIR__.'/../private':dirname(__DIR__,2).'/golden-auto-video-private';
require $private.'/app.php';require $private.'/agent_jobs.php';
header('Content-Type: application/json');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
try{
    if(empty($_SERVER['HTTPS'])&&!in_array($_SERVER['REMOTE_ADDR']??'',['127.0.0.1','::1'],true))throw new RuntimeException('HTTPS required.');
    if($_SERVER['REQUEST_METHOD']!=='POST')throw new RuntimeException('POST required.');
    $cfg=require $private.'/config.php';$cfg['asset_dir']=__DIR__.'/assets';$db=db($cfg);
    $auth=$_SERVER['HTTP_AUTHORIZATION']??('Bearer '.($_SERVER['HTTP_X_GOLDEN_AGENT_TOKEN']??''));$token=preg_match('/^Bearer ([a-f0-9]{64})$/',$auth,$m)?$m[1]:'';$saved=state($db,'windows_agent');
    if(!$token||!$saved||!hash_equals($saved['token_hash'],hash('sha256',$token))){http_response_code(401);throw new RuntimeException('Invalid rendering-agent token.');}
    $action=$_GET['action']??'';
    $in=$action==='upload'?$_POST:json_decode(file_get_contents('php://input'),true,512,JSON_THROW_ON_ERROR);
    if($action==='ping'){echo json_encode(['ok'=>true]);exit;}
    if($action==='claim'){echo json_encode(['job'=>agentClaim($db)],JSON_THROW_ON_ERROR);exit;}
    // All mutations of leased jobs serialize against claim/reclaim.
    $db->beginTransaction();
    if($action==='upload'){$q=$db->prepare('SELECT payload FROM jobs WHERE id=?');$q->execute([$in['id']??'']);$raw=$q->fetchColumn();if($raw){$done=json_decode($raw,true);if(($done['finish_status']??'')==='completed'&&hash_equals($done['completed_lease_hash']??'',hash('sha256',(string)($in['lease']??'')))){$db->commit();echo json_encode(['ok'=>true,'url'=>$done['captioned_url']]);exit;}}}
    $j=agentJob($db,(string)($in['id']??''),(string)($in['lease']??''));
    if($action==='heartbeat'){$j['lease_until']=time()+900;agentSave($db,$j);$db->commit();echo json_encode(['ok'=>true]);exit;}
    if($action==='fail'){$j['finish_status']='failed';$j['finish_error']=jobError($in['error']??'Windows renderer failed.');unset($j['lease_token']);agentSave($db,$j);$db->commit();echo json_encode(['ok'=>true]);exit;}
    if($action==='upload'){
        $f=$_FILES['video']??null;if(!$f||$f['error']!==UPLOAD_ERR_OK||!is_uploaded_file($f['tmp_name']))throw new RuntimeException('Video upload failed. Check PHP upload limits.');
        if($f['size']<1000||$f['size']>100000000)throw new RuntimeException('Video must be under 100 MB.');
        $h=fopen($f['tmp_name'],'rb');$sig=fread($h,64);fclose($h);if(substr($sig,4,4)!=='ftyp')throw new RuntimeException('Upload must be an MP4 file.');
        $name=bin2hex(random_bytes(20)).'.mp4';if(!is_dir($cfg['asset_dir']))mkdir($cfg['asset_dir'],0755,true);
        if(!move_uploaded_file($f['tmp_name'],$cfg['asset_dir'].'/'.$name))throw new RuntimeException('Unable to save rendered video.');
        $j['finish_status']='completed';$j['finish_error']='';$j['captioned_url']=rtrim($cfg['public_base_url'],'/').'/assets/'.$name;$j['finish_completed_at']=gmdate('c');$j['completed_lease_hash']=hash('sha256',$j['lease_token']);unset($j['lease_token']);agentSave($db,$j);$db->commit();echo json_encode(['ok'=>true,'url'=>$j['captioned_url']]);exit;
    }
    throw new RuntimeException('Unknown worker action.');
}catch(Throwable $e){if(isset($db)&&$db->inTransaction())$db->rollBack();if(http_response_code()===200)http_response_code(400);echo json_encode(['error'=>$e->getMessage()]);}
