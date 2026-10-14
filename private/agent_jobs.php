<?php
declare(strict_types=1);
function agentSave(PDO $db,array $j):void{$q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($j,JSON_THROW_ON_ERROR),$j['id']]);}
function agentClaim(PDO $db):?array {
    $db->beginTransaction();try{
        foreach($db->query('SELECT payload FROM jobs ORDER BY rowid')->fetchAll(PDO::FETCH_COLUMN)as $raw){$j=json_decode($raw,true);
            if(($j['finish_status']??'')==='rendering'&&($j['render_backend']??'')==='windows'&&($j['lease_until']??0)<time()){$j['finish_status']='queued';unset($j['lease_token']);agentSave($db,$j);}
            if(($j['finish_status']??'')!=='queued'||($j['status']??'')!=='completed'||!in_array($j['render_backend']??'windows',['windows'],true))continue;
            $j['render_backend']='windows';$j['finish_status']='rendering';$j['lease_token']=bin2hex(random_bytes(24));$j['lease_until']=time()+900;$j['finish_started_at']=gmdate('c');agentSave($db,$j);$db->commit();
            return ['id'=>$j['id'],'lease'=>$j['lease_token'],'video_url'=>$j['video_url'],'srt'=>$j['captions_srt'],'format'=>$j['format'],'vehicle'=>$j['vehicle'],'duration'=>$j['duration']??15];
        }$db->commit();return null;
    }catch(Throwable $e){if($db->inTransaction())$db->rollBack();throw $e;}
}
function agentJob(PDO $db,string $id,string $lease):array {
    $q=$db->prepare('SELECT payload FROM jobs WHERE id=?');$q->execute([$id]);$r=$q->fetchColumn();if(!$r)throw new RuntimeException('Job not found.');$j=json_decode($r,true);
    if(($j['finish_status']??'')!=='rendering'||empty($j['lease_token'])||!hash_equals($j['lease_token'],$lease)||($j['lease_until']??0)<time())throw new RuntimeException('Job lease expired or does not match.');return $j;
}
