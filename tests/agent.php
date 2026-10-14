<?php
require __DIR__.'/../private/app.php';require __DIR__.'/../private/agent_jobs.php';
function testAgent(bool $ok,string $s):void{if(!$ok)throw new RuntimeException('FAIL '.$s);echo "PASS $s\n";}
$dir=sys_get_temp_dir().'/ga-agent-'.bin2hex(random_bytes(6));$db=db(['data_dir'=>$dir]);
$j=['id'=>'test','status'=>'completed','finish_status'=>'queued','video_url'=>'https://example.com/master.mp4','captions_srt'=>"1\n00:00:00,000 --> 00:00:01,000\nTest\n",'format'=>'instagram_reels','vehicle'=>'TEST','duration'=>15];
$q=$db->prepare('INSERT INTO jobs VALUES (?,?,?)');$q->execute(['test','fp',json_encode($j)]);
try{
 $claim=agentClaim($db);testAgent($claim['id']==='test','queued job claimed');testAgent(agentClaim($db)===null,'second agent cannot duplicate active lease');
 testAgent(agentJob($db,'test',$claim['lease'])['finish_status']==='rendering','lease authorizes job');
 try{agentJob($db,'test','wrong');throw new LogicException('Wrong lease accepted');}catch(RuntimeException $e){testAgent(true,'wrong lease rejected');}
 $row=json_decode($db->query('SELECT payload FROM jobs')->fetchColumn(),true);$row['lease_until']=time()-1;agentSave($db,$row);$again=agentClaim($db);testAgent($again['lease']!==$claim['lease'],'expired lease recovered');
 testAgent(speechScript('Visit https://www.mygoldenauto.net.')==='Visit my golden auto dot N, E, T.','website spelling for speech');
 testAgent(speechScript('Visit mygoldenauto.net.')==='Visit my golden auto dot N, E, T.','plain website for speech');
}finally{$db=null;foreach(glob($dir.'/*')as $f)unlink($f);rmdir($dir);}
