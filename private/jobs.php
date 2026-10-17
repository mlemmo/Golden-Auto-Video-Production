<?php
declare(strict_types=1);
// Deleting a video job: removes the job record and its finished captioned file from this server.
// The generated master stays in Higgsfield history. Jobs still generating or rendering are protected.
const JOB_RUNNING=['preparing_references','submitting','queued','in_progress'];

function goldenJobDelete(PDO $db,array $cfg,string $id):array {
    $q=$db->prepare('SELECT payload FROM jobs WHERE id=?');$q->execute([$id]);$raw=$q->fetchColumn();
    if(!$raw)throw new RuntimeException('Video not found. Refresh the list.');
    $job=json_decode($raw,true,512,JSON_THROW_ON_ERROR);
    if(in_array($job['status']??'',JOB_RUNNING,true))
        throw new RuntimeException('This video is still being generated. Wait until it completes or fails before deleting, so a paid generation is not lost.');
    if(($job['finish_status']??'')==='rendering')
        throw new RuntimeException('This video is being captioned right now. Try again in a minute.');
    $t=$db->query("SELECT name FROM sqlite_master WHERE type='table' AND name='narration_lipsync'")->fetchColumn();
    if($t){
        $q=$db->prepare("SELECT COUNT(*) FROM narration_lipsync WHERE json_extract(payload,'$.source_video_id')=? AND json_extract(payload,'$.status') IN ('submitting','queued','in_progress')");
        $q->execute([$id]);if($q->fetchColumn()>0)throw new RuntimeException('A lip-sync job is still using this video. Wait for it to finish first.');
    }
    $q=$db->prepare('DELETE FROM jobs WHERE id=?');$q->execute([$id]);
    $base=rtrim((string)($cfg['public_base_url']??''),'/').'/assets/';$url=(string)($job['captioned_url']??'');
    if($base!=='/assets/'&&str_starts_with($url,$base)){
        $name=substr($url,strlen($base));
        if(preg_match('/^[a-f0-9]{40}\.mp4$/',$name)){$path=($cfg['asset_dir']??__DIR__.'/../public/assets').'/'.$name;if(is_file($path))unlink($path);}
    }
    // Uploaded footage belongs to this job only.
    if(($job['provider']??'')==='footage'&&preg_match('/^[a-f0-9]{32}\.(mp4|mov)$/',(string)($job['footage_file']??''))){$path=($cfg['asset_dir']??__DIR__.'/../public/assets').'/footage/'.$job['footage_file'];if(is_file($path))unlink($path);}
    if(($job['provider']??'')==='footage')return ['message'=>'Video and its uploaded footage deleted.'];
    return ['message'=>'Video deleted from the dashboard. The original generation stays in your Higgsfield history.'];
}
