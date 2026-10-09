package com.akshatgg.buddy.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Buddy's look, the Mac's tokens from src/renderer/common/base.css: the window grey, the card, the text, hairlines,
 * and Buddy's teal for what is chosen, focused or switched on. `goodSoft` and `errorSoft` are the tints behind a
 * verdict or an error, and `accentSoft` the one behind a note or a chosen card; `lineSoft` is a card's edge; `track`
 * and `control` are a segmented control's groove and its chosen segment.
 */
@Immutable
data class BuddyColors(
    val bg: Color,
    val card: Color,
    val fg: Color,
    val muted: Color,
    val line: Color,
    val lineSoft: Color,
    val accent: Color,
    val accentSoft: Color,
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
    lineSoft = Color(0xFFE5E5EA),
    accent = Color(0xFF1F7A70),
    accentSoft = Color(0x2620A898), // rgba(32, 168, 152, 0.15)
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
    lineSoft = Color(0xFF3A3A3D),
    accent = Color(0xFF5AD1C3),
    accentSoft = Color(0x295AD1C3), // rgba(90, 209, 195, 0.16)
    accentFg = Color(0xFF0B1F1D),
    good = Color(0xFF30D158),
    error = Color(0xFFFF7B72), // lighter than the system red, so that it reads at 4.5:1 on the dark card
    goodSoft = Color(0x2930D158), // rgba(48, 209, 88, 0.16)
    errorSoft = Color(0x1AFF6961), // rgba(255, 105, 97, 0.1)
    track = Color(0x1AFFFFFF), // rgba(255, 255, 255, 0.1)
    control = Color(0xFF4A4A4E),
)

/**
 * Claude Code's own terminal colours, for Claude mode (the Mac panel's .cli look, panel.css): black, white text, grey
 * for what is quiet, Claude's orange for its work, green and red for a tool that worked or failed.
 */
val ClaudeCliColors = BuddyColors(
    bg = Color(0xFF000000),
    card = Color(0xFF000000),
    fg = Color(0xFFF2F2F2),
    muted = Color(0xFF8C8C8C),
    line = Color(0xFF3A3A3A),
    lineSoft = Color(0xFF2C2C2C),
    accent = Color(0xFFD77757),
    accentSoft = Color(0x33D77757),
    accentFg = Color(0xFF1A0F0A),
    good = Color(0xFF4EBA65),
    error = Color(0xFFFF6B80),
    goodSoft = Color(0x294EBA65),
    errorSoft = Color(0x2EFF6B80),
    track = Color(0xFF2C2C2C), // what the person typed: the terminal's grey bar
    control = Color(0xFF3A3A3A),
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

/**
 * Claude mode as Claude Code's terminal looks, whatever the phone's light or dark: ClaudeCliColors, and every word in
 * the monospace font.
 */
@Composable
fun ClaudeCliTheme(content: @Composable () -> Unit) {
    val mono = Typography().let { t ->
        fun TextStyle.mono() = copy(fontFamily = FontFamily.Monospace)
        t.copy(
            bodyLarge = t.bodyLarge.mono().copy(fontSize = 13.sp, lineHeight = 19.sp), bodyMedium = t.bodyMedium.mono(),
            bodySmall = t.bodySmall.mono(), titleMedium = t.titleMedium.mono(), titleLarge = t.titleLarge.mono(),
            labelLarge = t.labelLarge.mono(), labelMedium = t.labelMedium.mono(),
        )
    }
    val round = RoundedCornerShape(BuddyRadius)
    CompositionLocalProvider(LocalBuddyColors provides ClaudeCliColors, LocalTextStyle provides mono.bodyLarge) {
        MaterialTheme(colorScheme = scheme(ClaudeCliColors, dark = true), typography = mono, shapes = Shapes(small = round, medium = round), content = content)
    }
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
