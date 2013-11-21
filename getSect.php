<?php

define('SECT_SIZE', 512);
define('MAX_SECT', 1760);

if (! isset($_GET['sect'])) {
	die();
}

$sect = (int) $_GET['sect'];

if ($sect < 0 || $sect >= MAX_SECT) {
	die();
}

header('Content-type: application/octet-stream');

$fil = fopen('ASI001.ADF', 'rb');
fseek($fil, $sect * SECT_SIZE);
$buf = fread($fil, SECT_SIZE);
fclose($fil);

echo $buf;

