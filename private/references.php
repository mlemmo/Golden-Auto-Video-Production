<?php
declare(strict_types=1);
require_once __DIR__.'/captions.php';
/**
 * Spoken form for Seedance native voice: like speechScript, but the website is said "my golden auto dot net"
 * (the spelled "N, E, T" form suits ElevenLabs and sounds wrong from Seedance). Place names stay as written and
 * get a pronunciation guide in the prompt (SPEECH_PRONUNCIATION).
 */
function nativeSpeech(string $s):string{
    $s=preg_replace('~(?<![A-Za-z0-9])(?:https?://)?(?:www\.)?mygoldenauto\.net/?(?![A-Za-z0-9/])~i','my golden auto dot net',$s);
    return acronymSpeech(numberSpeech(priceSpeech($s)));
}
/** Respellings written into the line Seedance speaks (it ignored the pronunciation note). Captions keep the real spelling. */
const SEEDANCE_RESPELL=['San Ramon'=>'San Ruh-mone'];
/** $extra: config 'respell' entries (word => how to write it for the voice), added to or overriding the defaults. */
function seedanceRespell(string $s,array $extra=[]):string{
    foreach(array_merge(SEEDANCE_RESPELL,$extra) as $word=>$say)if(is_string($word)&&is_string($say)&&$word!=='')$s=preg_replace('/\b'.preg_quote($word,'/').'\b/iu',$say,$s);
    return $s;
}
/** Pronunciations given to the native-voice model when the word appears in the script. */
const SPEECH_PRONUNCIATION=['San Ramon'=>'san ruh-MOHN, written "San Ruh-mone" above (rhymes with "a phone")','my golden auto dot net'=>'my GOLD-en AW-toh dot net, said as words, never spelled out letter by letter','Golden Auto'=>'GOLD-en AW-toh'];
function speechScript(string $s,bool $numbers=true):string{
    $s=preg_replace('~(?<![A-Za-z0-9])(?:https?://)?(?:www\.)?mygoldenauto\.net/?(?![A-Za-z0-9/])~i','my golden auto dot N, E, T',$s);
    $s=priceSpeech($s);
    return acronymSpeech($numbers?numberSpeech($s):$s);
}
/** Acronyms that contain vowels but are still said letter by letter. */
const SPEECH_SPELLED=['SUV','AWD','FWD','RWD','2WD','4WD','4X4','EX','EXL','LX','LE','SE','SEL','XLE','GT','GTI','AMG','STI','TDI','TSI','SRT','LED','USB','ABS','EV','ES','RS','SS','SV','SL','SR','SR5','LT','LS','LTZ','XLT','ST'];
/** Between spelled letters. Commas made Bella pause too long; hyphens keep the letters quick. */
const SPEECH_LETTER_SEPARATOR='-';
/**
 * Voice models try to read SUV or XV as words, so spoken text spells them out: "S-U-V", "X-V", "C-R-V".
 * Uppercase tokens only: known acronyms and short letter groups without vowels are spelled; other all-caps
 * inventory words become normal case (SUBARU → Subaru, RAM → Ram) so they are spoken as words.
 */
function acronymSpeech(string $s):string {
    return preg_replace_callback('/(?<![A-Za-z0-9])[A-Z0-9]+(?:-[A-Z0-9]+)*(?![A-Za-z0-9])/',function($m){
        $token=$m[0];if(ctype_digit(str_replace('-','',$token)))return $token;
        if(in_array(str_replace('-','',$token),SPEECH_SPELLED,true))return implode(SPEECH_LETTER_SEPARATOR,str_split(str_replace('-','',$token)));
        $parts=[];
        foreach(explode('-',$token) as $part){
            $runs=preg_split('/(?<=[A-Z])(?=\d)|(?<=\d)(?=[A-Z])/',$part);$out=[];$spelledOnly=true;
            foreach($runs as $run){
                if(ctype_digit($run)){$out[]=$run;$spelledOnly=false;}
                elseif(in_array($run,SPEECH_SPELLED,true)||(strlen($run)<=3&&!preg_match('/[AEIOU]/',$run)))$out[]=implode(SPEECH_LETTER_SEPARATOR,str_split($run));
                elseif(strlen($run)>1){$out[]=ucfirst(strtolower($run));$spelledOnly=false;}
                else{$out[]=$run;$spelledOnly=false;}
            }
            $parts[]=['text'=>implode(' ',$out),'spelled'=>$spelledOnly];
        }
        // CR-V → "C-R-V"; CX-30 → "C-X 30".
        $text=$parts[0]['text'];
        for($i=1;$i<count($parts);$i++)$text.=($parts[$i-1]['spelled']&&$parts[$i]['spelled']?SPEECH_LETTER_SEPARATOR:' ').$parts[$i]['text'];
        return $text;
    },$s);
}
function referenceFile(string $url,array $cfg):array {
    $base=rtrim((string)($cfg['public_base_url']??''),'/').'/assets/';
    if(!str_starts_with($url,$base))throw new RuntimeException('Place both reference images in this dashboard’s assets folder before uploading to Higgsfield.');
    $name=substr($url,strlen($base));if(!preg_match('/^[A-Za-z0-9_-]{1,100}\.(jpg|jpeg|png|webp)$/i',$name))throw new RuntimeException('Reference filename must be a simple JPG, PNG or WebP filename.');
    $dir=realpath($cfg['asset_dir']??(__DIR__.'/../public/assets'));$path=$dir===false?false:realpath($dir.'/'.$name);
    if($dir===false)throw new RuntimeException('Reference assets folder cannot be resolved.');
    if(!$path||!is_file($path))throw new RuntimeException('Reference file not found: '.$name);
    if(dirname($path)!==$dir)throw new RuntimeException('Reference file is outside the assets folder: '.$name);
    if(!is_readable($path))throw new RuntimeException('Reference file is not readable: '.$name);
    if(filesize($path)>20000000)throw new RuntimeException('Reference file exceeds 20 MB: '.$name);
    $bytes=file_get_contents($path);$size=@getimagesizefromstring($bytes);
    if(!$size||$size[0]*$size[1]>16000000||!in_array($size['mime']??'',['image/jpeg','image/png','image/webp'],true))throw new RuntimeException('Reference image is invalid or too large to decode.');
    return ['bytes'=>$bytes,'mime'=>$size['mime']];
}
function uploadHttp(string $method,string $url,array $headers,string $body):string {
    if(!str_starts_with($url,'https://'))
        throw new RuntimeException('Higgsfield upload requires HTTPS.');

    $mapped=[];
    foreach($headers as $header){
        $parts=explode(':',$header,2);
        if(count($parts)!==2)
            throw new RuntimeException('Invalid upload header.');
        $mapped[trim($parts[0])]=trim($parts[1]);
    }

    $payload=json_encode([
        'method'=>$method,
        'url'=>$url,
        'headers'=>$mapped,
        'body'=>base64_encode($body)
    ],JSON_THROW_ON_ERROR);

    $process=proc_open(
        ['/usr/bin/python3',__DIR__.'/reference_http.py'],
        [0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],
        $pipes
    );
    if(!is_resource($process))
        throw new RuntimeException('Cannot start Python reference uploader.');

    $offset=0;
    while($offset<strlen($payload)){
        $written=@fwrite($pipes[0],substr($payload,$offset,65536));
        if($written===false||$written===0)break;
        $offset+=$written;
    }
    fclose($pipes[0]);
    $output=stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    $exit=proc_close($process);

    $result=json_decode($output,true);
    $code=(int)($result['status']??0);
    if($offset!==strlen($payload)||$exit!==0||$code<200||$code>=300)
        throw new RuntimeException(
            'Reference upload '.$method.' failed (HTTP '.$code.'). No video was submitted.'
        );

    $decoded=base64_decode($result['body']??'',true);
    if($decoded===false)
        throw new RuntimeException('Invalid Python upload response.');
    return $decoded;
}
function uploadReference(string $url,array $cfg,?callable $transport=null):string {
    $transport??='uploadHttp';$file=referenceFile($url,$cfg);$key=(string)($cfg['higgsfield_key']??'');if(!$key)throw new RuntimeException('Configure your Higgsfield API key first.');
    $data=json_decode($transport('POST','https://api.higgsfield.ai/files/generate-upload-url',['Authorization: Key '.$key,'Content-Type: application/json'],json_encode(['content_type'=>$file['mime']],JSON_THROW_ON_ERROR)),true,512,JSON_THROW_ON_ERROR);
    if(!is_array($data)||!isset($data['upload_url'],$data['public_url'],$data['upload_headers'])||!is_array($data['upload_headers']))throw new RuntimeException('Higgsfield returned an incomplete upload response. No video was submitted.');
    foreach(['upload_url','public_url']as $field){$u=parse_url($data[$field]);if(($u['scheme']??'')!=='https'||empty($u['host'])||isset($u['user'])||isset($u['pass']))throw new RuntimeException('Invalid Higgsfield storage response.');}
    $headers=[];foreach($data['upload_headers']as $name=>$value){if(!is_string($name)||!is_string($value)||preg_match('/[\r\n]/',$name.$value)||in_array(strtolower($name),['authorization','cookie','proxy-authorization'],true))throw new RuntimeException('Unsafe upload headers in Higgsfield response.');$headers[]=$name.': '.$value;}
    // Only returned storage headers are sent. The API key never goes to storage.
    $transport('PUT',$data['upload_url'],$headers,$file['bytes']);
    return $data['public_url'];
}
function jobError(mixed $error):string {
    if($error===null)return '';if(!is_string($error))$error=json_encode($error);
    return substr(preg_replace('~https?://[^\s"<>]+~','[URL omitted]',(string)$error),0,2000);
}
