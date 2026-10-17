<?php
// CLI only, cron every minute: copies and sorts photos of website-imported client cars (see dcsProcessPhotos).
// Free: public photo downloads and a local image model. Its own lock, so captions are never held up.
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit('CLI only');}
require __DIR__.'/app.php';require_once __DIR__.'/importers.php';$cfg=require __DIR__.'/config.php';
$cfg['asset_dir']=$cfg['asset_dir']??__DIR__.'/../public/assets';
$db=db($cfg);$lock=fopen($cfg['data_dir'].'/photo-worker.lock','c');if(!$lock||!flock($lock,LOCK_EX|LOCK_NB))exit;
try{foreach(dcsProcessPhotos($db,$cfg,50) as $line)echo gmdate('c '),$line,"\n";}
catch(Throwable $e){echo gmdate('c '),'photo worker failed: ',$e->getMessage(),"\n";}
finally{flock($lock,LOCK_UN);fclose($lock);}
