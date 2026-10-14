<?php
require __DIR__.'/../private/app.php';
$list=inventory('https://www.mygoldenauto.net');
echo count($list)." live vehicles\n";
$v=enrich($list[array_search('019865',array_column($list,'StockNumber'))]);
echo title($v).' | '.money($v['price']).' | description '.strlen($v['description'])." bytes\n";
if(!$v['description']||!$v['photos']||!$v['price'])throw new RuntimeException('Incomplete detail extraction');
