<?php
header('Content-Type: application/json; charset=utf-8');

$mode = $_GET['mode'] ?? 'conversion';
$baseDir = __DIR__;
$conversionFile = $baseDir . '/conversion-data.json';
$logFile = $baseDir . '/dips-log.json';

if ($mode === 'conversion') {
    if (!file_exists($conversionFile)) {
        http_response_code(500);
        echo json_encode(['error' => 'Conversion data not available.']);
        exit;
    }

    echo file_get_contents($conversionFile);
    exit;
}

if ($mode === 'email') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        echo json_encode(['error' => 'Use POST to send email data.']);
        exit;
    }

    $date = $_POST['date'] ?? '';
    $readings = json_decode($_POST['readings'] ?? 'null', true);
    $liters = json_decode($_POST['liters'] ?? 'null', true);

    if (!is_string($date) || trim($date) === '' || !is_array($readings) || !is_array($liters)) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing or invalid form data.']);
        exit;
    }

    $to = 'fuel-dips@example.com';
    $subject = "Fuel dip report for {$date}";
    $boundary = md5((string)microtime(true));
    $headers = [];
    $headers[] = 'From: no-reply@fuel-dips.local';
    $headers[] = 'MIME-Version: 1.0';
    $headers[] = "Content-Type: multipart/mixed; boundary=\"{$boundary}\"";

    $body = "--{$boundary}\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 7bit\r\n\r\n";
    $body .= "Fuel dip report date: {$date}\r\n\r\n";
    $body .= "Readings (cm):\r\n";
    foreach ($readings as $fuel => $value) {
        $body .= "- {$fuel}: {$value}\r\n";
    }
    $body .= "\r\nCalculated liters: \r\n";
    foreach ($liters as $fuel => $value) {
        $body .= sprintf("- %s: %s L\r\n", $fuel, $value);
    }
    $body .= "\r\n";

    $attachmentPart = '';
    if (!empty($_FILES['document']) && $_FILES['document']['error'] === UPLOAD_ERR_OK) {
        $uploaded = $_FILES['document'];
        $tmpName = $uploaded['tmp_name'];
        $filename = basename($uploaded['name']);
        $fileContents = file_get_contents($tmpName);

        if ($fileContents !== false) {
            $base64File = chunk_split(base64_encode($fileContents));
            $attachmentPart .= "--{$boundary}\r\n";
            $attachmentPart .= "Content-Type: application/pdf; name=\"{$filename}\"\r\n";
            $attachmentPart .= "Content-Transfer-Encoding: base64\r\n";
            $attachmentPart .= "Content-Disposition: attachment; filename=\"{$filename}\"\r\n\r\n";
            $attachmentPart .= $base64File . "\r\n";
        }
    }

    $body .= $attachmentPart;
    $body .= "--{$boundary}--\r\n";

    $sent = @mail($to, $subject, $body, implode("\r\n", $headers));
    $emailStatus = $sent ? 'sent' : 'not sent';
    $emailWarning = $sent ? null : 'Email could not be delivered because PHP mail is not configured for this server.';

    $entry = [
        'timestamp' => date('c'),
        'date' => $date,
        'readings' => $readings,
        'liters' => $liters,
        'fileName' => $_FILES['document']['name'] ?? null,
        'emailStatus' => $emailStatus
    ];

    $existing = [];
    if (file_exists($logFile)) {
        $content = file_get_contents($logFile);
        $decoded = json_decode($content, true);
        if (is_array($decoded)) {
            $existing = $decoded;
        }
    }

    $existing[] = $entry;
    if (file_put_contents($logFile, json_encode($existing, JSON_PRETTY_PRINT)) === false) {
        http_response_code(500);
        echo json_encode(['error' => 'Unable to save dip log.']);
        exit;
    }

    $response = ['message' => 'Dip report recorded successfully.'];
    if ($emailWarning !== null) {
        $response['warning'] = $emailWarning;
    }
    echo json_encode($response);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'Unknown mode.']);
