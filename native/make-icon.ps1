# Draws the Opale gem and writes native\opale.ico (PNG-compressed frames).
# Run once; the .ico is committed so building does not need this script.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-GemPng([int]$size) {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    $s = $size / 64.0
    $pt = { param($x, $y) New-Object System.Drawing.PointF(($x * $s), ($y * $s)) }

    $outline = @((& $pt 32 3), (& $pt 56 20), (& $pt 47 54), (& $pt 17 54), (& $pt 8 20))
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush((& $pt 8 3), (& $pt 56 54), [System.Drawing.Color]::White, [System.Drawing.Color]::White)
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
    $blend.Colors = @([System.Drawing.Color]::FromArgb(255, 253, 230, 138), [System.Drawing.Color]::FromArgb(255, 245, 158, 11), [System.Drawing.Color]::FromArgb(255, 194, 65, 12))
    $blend.Positions = @(0.0, 0.5, 1.0)
    $brush.InterpolationColors = $blend
    $g.FillPolygon($brush, $outline)

    # Facets: only where there are enough pixels to keep them crisp.
    if ($size -ge 32) {
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 255, 255, 255), [Math]::Max(1.0, 1.4 * $s))
        $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
        $g.DrawLines($pen, @((& $pt 32 3), (& $pt 39 24), (& $pt 56 20)))
        $g.DrawLine($pen, (& $pt 39 24), (& $pt 47 54))
        $g.DrawLines($pen, @((& $pt 39 24), (& $pt 23 31), (& $pt 8 20)))
        $g.DrawLine($pen, (& $pt 23 31), (& $pt 17 54))
        $g.DrawLine($pen, (& $pt 23 31), (& $pt 32 3))
        $pen.Dispose()
    }
    $g.Dispose(); $brush.Dispose()
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    return ,$stream.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$frames = $sizes | ForEach-Object { ,(New-GemPng $_) }

$target = Join-Path $PSScriptRoot 'opale.ico'
$out = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($out)
$writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dimension = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $writer.Write([Byte]$dimension); $writer.Write([Byte]$dimension); $writer.Write([Byte]0); $writer.Write([Byte]0)
    $writer.Write([UInt16]1); $writer.Write([UInt16]32)
    $writer.Write([UInt32]$frames[$i].Length); $writer.Write([UInt32]$offset)
    $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write($frame) }
$writer.Flush()
[System.IO.File]::WriteAllBytes($target, $out.ToArray())
Write-Output "Wrote $target ($($out.Length) bytes, $($sizes.Count) sizes)"
