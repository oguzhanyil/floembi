# Yıldırım Technologies Y işaretinden esinlenen Floem BI Desktop simgesi.
# Windows'un System.Drawing bileşeniyle PNG + çok boyutlu ICO üretir; ek paket gerektirmez.
Add-Type -AssemblyName System.Drawing

$resourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pngPath = Join-Path $resourceDir 'floem-bi.png'
$icoPath = Join-Path $resourceDir 'floem-bi.ico'

function Point([single]$x, [single]$y) {
    return [System.Drawing.PointF]::new($x, $y)
}

$bitmap = [System.Drawing.Bitmap]::new(512, 512)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$graphics.Clear([System.Drawing.Color]::Transparent)

$round = [System.Drawing.Drawing2D.GraphicsPath]::new()
$round.AddArc(12, 12, 108, 108, 180, 90)
$round.AddArc(392, 12, 108, 108, 270, 90)
$round.AddArc(392, 392, 108, 108, 0, 90)
$round.AddArc(12, 392, 108, 108, 90, 90)
$round.CloseFigure()
$background = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    [System.Drawing.Rectangle]::new(0, 0, 512, 512),
    [System.Drawing.ColorTranslator]::FromHtml('#07162F'),
    [System.Drawing.ColorTranslator]::FromHtml('#0E335E'), 45
)
$graphics.FillPath($background, $round)

$glowPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$glowPath.AddEllipse(72, 62, 368, 368)
$glow = [System.Drawing.Drawing2D.PathGradientBrush]::new($glowPath)
$glow.CenterColor = [System.Drawing.Color]::FromArgb(110, 0, 148, 245)
$glow.SurroundColors = [System.Drawing.Color[]]@([System.Drawing.Color]::FromArgb(0, 0, 148, 245))
$graphics.FillPath($glow, $glowPath)

$deep = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#0756B8'))
$blue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#008FF0'))
$cyan = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#18B9FF'))
$light = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#56D8FF'))

# Açılı kolların gölgeleri, parlak üst yüzeyleri ve aşağı uzanan iki parçalı gövde.
$graphics.FillPolygon($deep, [System.Drawing.PointF[]]@((Point 103 141), (Point 130 141), (Point 249 244), (Point 249 319), (Point 226 300), (Point 226 257), (Point 103 181)))
$graphics.FillPolygon($blue, [System.Drawing.PointF[]]@((Point 130 141), (Point 155 141), (Point 256 228), (Point 256 276), (Point 243 289), (Point 243 247)))
$graphics.FillPolygon($light, [System.Drawing.PointF[]]@((Point 130 142), (Point 155 142), (Point 250 224), (Point 250 239)))
$graphics.FillPolygon($deep, [System.Drawing.PointF[]]@((Point 409 141), (Point 382 141), (Point 263 244), (Point 263 319), (Point 286 300), (Point 286 257), (Point 409 181)))
$graphics.FillPolygon($blue, [System.Drawing.PointF[]]@((Point 382 141), (Point 357 141), (Point 256 228), (Point 256 276), (Point 269 289), (Point 269 247)))
$graphics.FillPolygon($cyan, [System.Drawing.PointF[]]@((Point 382 142), (Point 357 142), (Point 262 224), (Point 262 239)))
$graphics.FillPolygon($blue, [System.Drawing.PointF[]]@((Point 226 267), (Point 256 291), (Point 256 424), (Point 226 395)))
$graphics.FillPolygon($cyan, [System.Drawing.PointF[]]@((Point 256 291), (Point 286 267), (Point 286 395), (Point 256 424)))

# Referanstaki kare piksel uçları.
foreach ($p in @(@(78, 126, 16), @(97, 107, 13), @(108, 134, 11), @(418, 126, 16), @(402, 107, 13), @(391, 134, 11))) {
    $brush = if ($p[0] -lt 256) { $blue } else { $cyan }
    $graphics.FillRectangle($brush, [int]$p[0], [int]$p[1], [int]$p[2], [int]$p[2])
}

# Üç küçük sütun, bu kurumsal işareti BI Desktop simgesi olarak ayırt eder.
$graphics.FillRectangle($deep, 360, 369, 15, 34)
$graphics.FillRectangle($blue, 382, 350, 15, 53)
$graphics.FillRectangle($cyan, 404, 329, 15, 74)
$border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(110, 82, 166, 231), 2)
$graphics.DrawPath($border, $round)
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = @()
foreach ($size in $sizes) {
    $large = [System.Drawing.Image]::FromFile($pngPath)
    $small = [System.Drawing.Bitmap]::new($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($small)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.DrawImage($large, 0, 0, $size, $size)
    $stream = [System.IO.MemoryStream]::new()
    $small.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $frames += ,@($size, $stream.ToArray())
    $stream.Dispose()
    $g.Dispose()
    $small.Dispose()
    $large.Dispose()
}

$file = [System.IO.File]::Create($icoPath)
$writer = [System.IO.BinaryWriter]::new($file)
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($frame in $frames) {
    $size = [int]$frame[0]
    $bytes = [byte[]]$frame[1]
    $writer.Write([byte]($size % 256))
    $writer.Write([byte]($size % 256))
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]32)
    $writer.Write([uint32]$bytes.Length)
    $writer.Write([uint32]$offset)
    $offset += $bytes.Length
}
foreach ($frame in $frames) { $writer.Write([byte[]]$frame[1]) }
$writer.Dispose()
Write-Output "Simge oluşturuldu: $pngPath / $icoPath"
