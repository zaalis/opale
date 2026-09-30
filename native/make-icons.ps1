# Draws the Opale application icon (amber gem on a dark rounded tile) as PNG files.
# Run once on Windows; the PNGs are committed, so building does not need this script.
#   powershell -ExecutionPolicy Bypass -File native\make-icons.ps1 -Style mac   -Out native\icons\mac
#   powershell -ExecutionPolicy Bypass -File native\make-icons.ps1 -Style linux -Out native\icons\hicolor
param(
    [ValidateSet('mac', 'linux')][string]$Style = 'mac',
    [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
. {
    Add-Type -ReferencedAssemblies System.Drawing @'
using System.Drawing; using System.Drawing.Drawing2D;
public static class RoundRect {
    public static GraphicsPath Make(RectangleF r, float radius) {
        float d = radius * 2; var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90); p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure(); return p;
    }
}
'@
}

function New-Icon([int]$size, [string]$style) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'; $g.InterpolationMode = 'HighQualityBicubic'
    $g.Clear([System.Drawing.Color]::Transparent)

    # macOS icons leave room around the tile for the system shadow; Linux icons fill their square.
    $margin = if ($style -eq 'mac') { $size * 0.0977 } else { $size * 0.05 }
    $tile = $size - 2 * $margin
    $rect = New-Object System.Drawing.RectangleF($margin, $margin, $tile, $tile)
    $radius = $tile * 0.2237

    if ($style -eq 'mac' -and $size -ge 64) {
        for ($i = 14; $i -ge 1; $i--) {
            $grow = $i * $size * 0.0011
            $r = New-Object System.Drawing.RectangleF(($rect.X - $grow), ($rect.Y - $grow + $size * 0.012), ($rect.Width + 2 * $grow), ($rect.Height + 2 * $grow))
            $path = [RoundRect]::Make($r, $radius + $grow)
            $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(7, 0, 0, 0))
            $g.FillPath($brush, $path); $brush.Dispose(); $path.Dispose()
        }
    }

    $tilePath = [RoundRect]::Make($rect, $radius)
    $fill = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(255, 0x2a, 0x28, 0x33), [System.Drawing.Color]::FromArgb(255, 0x11, 0x10, 0x16), 90.0)
    $g.FillPath($fill, $tilePath); $fill.Dispose()

    # Soft amber glow behind the gem.
    $g.SetClip($tilePath)
    $glowRect = New-Object System.Drawing.RectangleF(($size * 0.16), ($size * 0.16), ($size * 0.68), ($size * 0.68))
    $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath; $glowPath.AddEllipse($glowRect)
    $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
    $glow.CenterColor = [System.Drawing.Color]::FromArgb(70, 245, 158, 11)
    $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 245, 158, 11))
    $g.FillPath($glow, $glowPath); $glow.Dispose(); $glowPath.Dispose()
    $g.ResetClip()

    # The gem, drawn in a 64-unit box (same outline as the favicon).
    $s = ($tile * 0.56) / 48.0
    $ox = $size / 2 - 32 * $s; $oy = $size / 2 - 28 * $s
    $pt = { param($x, $y) New-Object System.Drawing.PointF(($ox + $x * $s), ($oy + $y * $s)) }
    $outline = @((& $pt 32 4), (& $pt 54 20), (& $pt 46 52), (& $pt 18 52), (& $pt 10 20))
    $gem = New-Object System.Drawing.Drawing2D.LinearGradientBrush((& $pt 10 4), (& $pt 54 52), [System.Drawing.Color]::White, [System.Drawing.Color]::White)
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
    $blend.Colors = @([System.Drawing.Color]::FromArgb(255, 0xfd, 0xe6, 0x8a), [System.Drawing.Color]::FromArgb(255, 0xf5, 0x9e, 0x0b), [System.Drawing.Color]::FromArgb(255, 0xc2, 0x41, 0x0c))
    $blend.Positions = @(0.0, 0.5, 1.0)
    $gem.InterpolationColors = $blend
    $g.FillPolygon($gem, $outline); $gem.Dispose()

    # Light and shade on the facets.
    $light = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(48, 255, 255, 255))
    $g.FillPolygon($light, @((& $pt 32 4), (& $pt 38 24), (& $pt 54 20))); $light.Dispose()
    $shade = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 90, 20, 0))
    $g.FillPolygon($shade, @((& $pt 24 30), (& $pt 38 24), (& $pt 46 52), (& $pt 18 52))); $shade.Dispose()
    if ($size -ge 32) {
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 255, 255, 255), [Math]::Max(1.0, 1.4 * $s))
        $pen.LineJoin = 'Round'
        $g.DrawLines($pen, @((& $pt 32 4), (& $pt 38 24), (& $pt 54 20)))
        $g.DrawLine($pen, (& $pt 38 24), (& $pt 46 52))
        $g.DrawLines($pen, @((& $pt 38 24), (& $pt 24 30), (& $pt 10 20)))
        $g.DrawLine($pen, (& $pt 24 30), (& $pt 18 52))
        $g.DrawLine($pen, (& $pt 24 30), (& $pt 32 4))
        $pen.Dispose()
    }

    # A fine highlight along the top edge of the tile.
    if ($size -ge 64) {
        $g.SetClip($tilePath)
        $edge = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(34, 255, 255, 255), [Math]::Max(1.0, $size / 256.0))
        $g.DrawPath($edge, $tilePath); $edge.Dispose()
        $g.ResetClip()
    }
    $tilePath.Dispose(); $g.Dispose()
    return $bmp
}

New-Item -ItemType Directory -Force $Out | Out-Null
$sizes = if ($Style -eq 'mac') { 16, 32, 64, 128, 256, 512, 1024 } else { 16, 24, 32, 48, 64, 128, 256, 512 }
foreach ($size in $sizes) {
    $target = if ($Style -eq 'mac') { Join-Path $Out "icon_$size.png" } else {
        $dir = Join-Path $Out "${size}x${size}\apps"; New-Item -ItemType Directory -Force $dir | Out-Null; Join-Path $dir 'opale.png'
    }
    $bitmap = New-Icon $size $Style
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    Write-Output "Wrote $target"
}
