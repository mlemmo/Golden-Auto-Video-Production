<?php
// Sign-in check for the Node service while PHP still owns login (Node port, see docs/NODE_PORT_HANDOFF.md).
// The Node service forwards the browser's cookie, CSRF header and request method here and gets back 200 with the
// selected client, 401 when not signed in, or 403 when a non-GET request lacks the session's CSRF token.
// It reads the session only (no changes), the same way public/index.php does.
declare(strict_types=1);
$private=is_file(__DIR__.'/../private/app.php')?__DIR__.'/../private':dirname(__DIR__,2).'/golden-auto-video-private';
require $private.'/app.php';require_once $private.'/clients.php';
$cfg=require $private.'/config.php';
header('Content-Type: application/json');header('Cache-Control: no-store');header('X-Content-Type-Options: nosniff');
$isHttps=isset($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off';
session_set_cookie_params(['httponly'=>true,'secure'=>$isHttps,'samesite'=>'Strict']);
session_start(['read_and_close'=>true]);
if(!($_SESSION['auth']??false)){http_response_code(401);echo json_encode(['error'=>'Sign in again.']);exit;}
$method=strtoupper((string)($_SERVER['HTTP_X_NODE_METHOD']??'POST'));
if($method!=='GET'&&!hash_equals((string)($_SESSION['csrf']??''),(string)($_SERVER['HTTP_X_CSRF_TOKEN']??''))){http_response_code(403);echo json_encode(['error'=>'Invalid request.']);exit;}
// Current client, chosen exactly as public/index.php does.
$db=db($cfg);$clients=clientsLoad($db);$client=(string)($_SESSION['client']??CLIENT_DEFAULT);
if(!in_array($client,array_column($clients['items'],'id'),true))$client=CLIENT_DEFAULT;
echo json_encode(['client'=>$client]);
