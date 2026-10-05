package com.example.opale.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Dark = darkColorScheme(
    primary = Color(0xFFFBBF24), onPrimary = Color(0xFF241A00),
    primaryContainer = Color(0xFF3B2C05), onPrimaryContainer = Color(0xFFFFE7AD),
    secondaryContainer = Color(0xFF2A2932), onSecondaryContainer = Color(0xFFF1EEF8),
    surfaceContainer = Color(0xFF201F27), surfaceContainerHigh = Color(0xFF2B2933),
    secondary = Color(0xFFD6CBAF), background = Color(0xFF131218),
    surface = Color(0xFF1E1D25), onBackground = Color(0xFFECEBF3),
    onSurface = Color(0xFFECEBF3), surfaceVariant = Color(0xFF282731),
    onSurfaceVariant = Color(0xFFC6C3D3), outline = Color(0xFF8D899B)
)
private val Light = lightColorScheme(
    primary = Color(0xFF825500), onPrimary = Color.White,
    primaryContainer = Color(0xFFFFE3A2), onPrimaryContainer = Color(0xFF322300),
    secondaryContainer = Color(0xFFF0E6D0), onSecondaryContainer = Color(0xFF302B1D),
    surfaceContainer = Color(0xFFF0EEF4), surfaceContainerHigh = Color(0xFFE9E7EE),
    secondary = Color(0xFF625B4A), background = Color(0xFFF3F2F7),
    surface = Color.White, onBackground = Color(0xFF1C1B23),
    onSurface = Color(0xFF1C1B23), surfaceVariant = Color(0xFFEBEAF1),
    onSurfaceVariant = Color(0xFF494650), outline = Color(0xFF767280)
)
@Composable
fun OpaleTheme(mode: String = "system", content: @Composable () -> Unit) {
    val dark = if (mode == "system") isSystemInDarkTheme() else mode == "dark"
    MaterialTheme(colorScheme = if (dark) Dark else Light, typography = Typography, content = content)
}
