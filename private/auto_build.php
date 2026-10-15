<?php
declare(strict_types=1);
// One-approval build, run by caption_worker.php every minute before rendering:
// 1. auto-build lip-sync jobs still at fal are checked (status checks are free; nothing is resubmitted);
// 2. a finished lip-synced video gets its captions timed from the approved narration audio and is queued;
// 3. caption_worker then renders the queued job (intro card, captions, closing card) in the same run.
// Native-voice Seedance jobs (voice=native): their Higgsfield status is checked (free) and, once complete, they are
// queued with captions_from_audio so caption_worker times the captions from the video's own speech.
require_once __DIR__.'/narrations.php';
require_once __DIR__.'/finishing.php';

function goldenAutoBuild(PDO $db,array $cfg,?callable $poll=null,?callable $hfStatus=null):array {
    narrationTables($db);
    $hfStatus??=fn(string $requestId)=>json_decode(request('https://api.higgsfield.ai/requests/'.rawurlencode($requestId).'/status',null,(string)($cfg['higgsfield_key']??'')),true,512,JSON_THROW_ON_ERROR);
    $log=goldenNativeBuild($db,$hfStatus);
    $poll??=fn(string $id)=>narrationApi('narration_poll',['id'=>$id],$cfg,$db);
    foreach($db->query('SELECT payload FROM narration_lipsync ORDER BY rowid')->fetchAll(PDO::FETCH_COLUMN) as $raw){
        $r=json_decode($raw,true);
        if(empty($r['auto_build'])||empty($r['request_id'])||!in_array($r['status']??'',['queued','in_progress','unknown'],true))continue;
        try{$poll($r['id']);$log[]='checked lip-sync '.$r['id'];}
        catch(Throwable $e){
            // Leave the job for the next run; record the reason so the dashboard shows it.
            $r=narrationLoad($db,'narration_lipsync',$r['id']);$r['error']=jobError('Automatic status check failed: '.$e->getMessage());narrationSave($db,'narration_lipsync',$r);
            $log[]='lip-sync check failed '.$r['id'];
        }
    }
    foreach($db->query('SELECT payload FROM jobs ORDER BY rowid')->fetchAll(PDO::FETCH_COLUMN) as $raw){
        $job=json_decode($raw,true);
        if(empty($job['auto_build'])||($job['status']??'')!=='completed'||!empty($job['finish_status'])||($job['provider']??'')!=='fal_lipsync')continue;
        try{
            $draft=goldenFinishDraft($db,$cfg,$job);
            $job['captions_srt']=validateSrt((string)$draft['srt'],(float)($job['duration']??15));
            $job['finish_status']='queued';$job['render_backend']='linux';$job['finish_error']='';$job['captioned_url']=null;$job['auto_queued_at']=gmdate('c');
            $log[]='queued final render '.$job['id'];
        }catch(Throwable $e){
            $job['finish_status']='failed';$job['finish_error']=jobError('Automatic build stopped: '.$e->getMessage());
            $log[]='build failed '.$job['id'];
        }
        $q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job,JSON_THROW_ON_ERROR),$job['id']]);
    }
    return $log;
}

/** Native-voice jobs: follow the Seedance request, then queue the captioned final render. No paid calls. */
function goldenNativeBuild(PDO $db,callable $hfStatus):array {
    $log=[];
    foreach($db->query('SELECT payload FROM jobs ORDER BY rowid')->fetchAll(PDO::FETCH_COLUMN) as $raw){
        $job=json_decode($raw,true);
        if(($job['voice']??'')!=='native'||empty($job['auto_build'])||empty($job['request_id'])||!empty($job['finish_status']))continue;
        if(in_array($job['status']??'',['failed','canceled','nsfw'],true))continue;
        if(($job['status']??'')!=='completed'){
            try{
                $r=$hfStatus($job['request_id']);
                $job['status']=$r['status']??'unknown';$job['video_url']=$r['video']['url']??($job['video_url']??null);
                $job['error']=jobError($r['error']??$r['detail']??null);$log[]='checked seedance '.$job['id'].': '.$job['status'];
            }catch(Throwable $e){$job['error']=jobError('Automatic status check failed: '.$e->getMessage());$log[]='seedance check failed '.$job['id'];}
        }
        if(($job['status']??'')==='completed'&&!empty($job['video_url'])){
            $job['captions_from_audio']=true;$job['captions_srt']='';
            $job['finish_status']='queued';$job['render_backend']='linux';$job['finish_error']='';$job['captioned_url']=null;$job['auto_queued_at']=gmdate('c');
            $log[]='queued final render '.$job['id'];
        }
        $q=$db->prepare('UPDATE jobs SET payload=? WHERE id=?');$q->execute([json_encode($job,JSON_THROW_ON_ERROR),$job['id']]);
    }
    return $log;
}
