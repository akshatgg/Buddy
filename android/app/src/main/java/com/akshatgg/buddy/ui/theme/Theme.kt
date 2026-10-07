package com.akshatgg.buddy.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Buddy's look, the Mac's tokens from src/renderer/common/base.css: the window grey, the card, the text, hairlines,
 * and Buddy's teal for what is chosen, focused or switched on. `goodSoft` and `errorSoft` are the tints behind a
 * verdict or an error; `track` and `control` are a segmented control's groove and its chosen segment.
 */
@Immutable
data class BuddyColors(
    val bg: Color,
    val card: Color,
    val fg: Color,
    val muted: Color,
    val line: Color,
    val accent: Color,
    val accentFg: Color,
    val good: Color,
    val error: Color,
    val goodSoft: Color,
    val errorSoft: Color,
    val track: Color,
    val control: Color,
)

val LightBuddyColors = BuddyColors(
    bg = Color(0xFFF5F5F7),
    card = Color(0xFFFFFFFF),
    fg = Color(0xFF1D1D1F),
    muted = Color(0xFF626267),
    line = Color(0xFFD1D1D6),
    accent = Color(0xFF1F7A70),
    accentFg = Color(0xFFFFFFFF),
    good = Color(0xFF167A3E),
    error = Color(0xFFD70015),
    goodSoft = Color(0x1F167A3E), // rgba(22, 122, 62, 0.12)
    errorSoft = Color(0x14D70015), // rgba(215, 0, 21, 0.08)
    track = Color(0x12000000), // rgba(0, 0, 0, 0.07)
    control = Color(0xFFFFFFFF),
)

val DarkBuddyColors = BuddyColors(
    bg = Color(0xFF1E1E20),
    card = Color(0xFF2C2C2F),
    fg = Color(0xFFF5F5F7),
    muted = Color(0xFFA6A6AB),
    line = Color(0xFF4A4A4E),
    accent = Color(0xFF5AD1C3),
    accentFg = Color(0xFF0B1F1D),
    good = Color(0xFF30D158),
    error = Color(0xFFFF7B72), // lighter than the system red, so that it reads at 4.5:1 on the dark card
    goodSoft = Color(0x2930D158), // rgba(48, 209, 88, 0.16)
    errorSoft = Color(0x1AFF6961), // rgba(255, 105, 97, 0.1)
    track = Color(0x1AFFFFFF), // rgba(255, 255, 255, 0.1)
    control = Color(0xFF4A4A4E),
)

/** The Mac's --radius. */
val BuddyRadius = 10.dp

private val LocalBuddyColors = staticCompositionLocalOf { LightBuddyColors }

object Buddy {
    /** The tokens Material's colour scheme has no place for (good, the tints, track, control), and the rest by their own names. */
    val colors: BuddyColors
        @Composable @ReadOnlyComposable get() = LocalBuddyColors.current
}

private fun scheme(c: BuddyColors, dark: Boolean) = if (dark) {
    darkColorScheme(
        primary = c.accent, onPrimary = c.accentFg, background = c.bg, onBackground = c.fg,
        surface = c.card, onSurface = c.fg, surfaceVariant = c.bg, onSurfaceVariant = c.muted,
        surfaceContainer = c.card, surfaceContainerHigh = c.card, surfaceContainerHighest = c.card,
        outline = c.line, outlineVariant = c.line, error = c.error, onError = c.bg,
    )
} else {
    lightColorScheme(
        primary = c.accent, onPrimary = c.accentFg, background = c.bg, onBackground = c.fg,
        surface = c.card, onSurface = c.fg, surfaceVariant = c.bg, onSurfaceVariant = c.muted,
        surfaceContainer = c.card, surfaceContainerHigh = c.card, surfaceContainerHighest = c.card,
        outline = c.line, outlineVariant = c.line, error = c.error, onError = c.card,
    )
}

/** Buddy's colours in light and dark, as Material 3's, and its rounded corners. */
@Composable
fun BuddyTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (dark) DarkBuddyColors else LightBuddyColors
    val round = RoundedCornerShape(BuddyRadius)
    CompositionLocalProvider(LocalBuddyColors provides colors) {
        MaterialTheme(
            colorScheme = scheme(colors, dark),
            shapes = Shapes(small = round, medium = round),
            content = content,
        )
    }
}
