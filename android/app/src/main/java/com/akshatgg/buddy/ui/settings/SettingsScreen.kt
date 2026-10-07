package com.akshatgg.buddy.ui.settings

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.akshatgg.buddy.BuildConfig
import com.akshatgg.buddy.account.User
import com.akshatgg.buddy.ai.aiSection
import com.akshatgg.buddy.store.BuddySize
import com.akshatgg.buddy.ui.common.AiForm
import com.akshatgg.buddy.ui.common.AiFormModel
import com.akshatgg.buddy.ui.common.BuddyPicker
import com.akshatgg.buddy.ui.common.Note
import com.akshatgg.buddy.ui.common.StatusLine
import com.akshatgg.buddy.ui.common.allowed
import com.akshatgg.buddy.ui.common.openFloatSettings
import com.akshatgg.buddy.ui.common.rememberAllowed
import com.akshatgg.buddy.ui.panel.Primary
import com.akshatgg.buddy.ui.panel.ROUNDED
import com.akshatgg.buddy.ui.panel.Secondary
import com.akshatgg.buddy.ui.panel.Segmented
import com.akshatgg.buddy.ui.theme.Buddy
import com.akshatgg.buddy.ui.theme.BuddyRadius
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlin.time.Duration.Companion.seconds

/** A part of Settings to scroll to ("ai", "account" or "buddy"). A new one each time, so the same part can be asked again. */
class SectionRequest(val name: String)

/** What Settings asks of Android. MainActivity wires them; a test leaves them be. */
class SettingsCallbacks(
    /** Google's account picker, then the free-mode settings. */
    val signIn: () -> Unit = {},
    /** The buddy or its size changed: the floating one shows it. */
    val lookChanged: () -> Unit = {},
    /** Buddy was turned on or off: the floating one comes or goes. */
    val powerChanged: (Boolean) -> Unit = {},
    val askNotifications: () -> Unit = {},
)

private val SIZES = listOf(BuddySize.SMALL to "Small", BuddySize.MEDIUM to "Medium", BuddySize.LARGE to "Large")

/** The Mac's initials: the first letters of the first two words of the name, else the email's first letter. */
internal fun initials(name: String, email: String): String {
    // Whole characters, not halves of one: an emoji, or a letter from beyond the basic set, is two units of a string.
    fun first(text: String) = if (text.isEmpty()) "" else text.substring(0, text.offsetByCodePoints(0, 1))
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    val letters = if (words.isNotEmpty()) words.take(2).map(::first) else listOf(first(email))
    return letters.joinToString("").uppercase()
}

/**
 * Settings: one page of cards in the Mac's order (the account, the buddy, the AI, the permissions) and the version.
 * `section` scrolls the page to one of them: the panel's and the Fix sheet's "Open Settings" ask for it.
 */
@Composable
fun SettingsScreen(model: SettingsModel, ai: AiFormModel, section: SectionRequest?, on: SettingsCallbacks) {
    val state by model.state.collectAsStateWithLifecycle(context = Dispatchers.Main.immediate)
    val user by model.user.collectAsStateWithLifecycle()
    val free by model.free.collectAsStateWithLifecycle()
    val allowed by rememberAllowed()
    val context = LocalContext.current
    val scroll = rememberScrollState()
    val tops = remember { mutableStateMapOf<String, Int>() }

    LaunchedEffect(Unit) { model.refreshFree() }
    LifecycleResumeEffect(Unit) {
        if (model.resumed(canFloat = context.allowed().float)) on.powerChanged(true)
        onPauseOrDispose {}
    }
    LaunchedEffect(section) {
        val name = section?.name ?: return@LaunchedEffect
        val top = snapshotFlow { tops[name] }.filterNotNull().first()
        scroll.animateScrollTo(top)
    }
    fun Modifier.section(name: String) = onGloballyPositioned { tops[name] = it.positionInParent().y.toInt() }

    // A Surface, so that every word on the page is in the text colour, in light and dark.
    Surface(Modifier.fillMaxSize(), color = Buddy.colors.bg, contentColor = Buddy.colors.fg) {
        Box(contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier
                    .widthIn(max = 560.dp)
                    .fillMaxWidth()
                    // The status bar stays clear of the page as it scrolls; the navigation bar (and the keyboard) is room at
                    // the end of it.
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))
                    .verticalScroll(scroll)
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
                    .padding(horizontal = 16.dp, vertical = 20.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("Settings", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)

                Title("Account", Modifier.section("account"))
                Card {
                    AccountRow(user)
                    if (user == null) {
                        Primary("Sign in with Google", enabled = !state.signingIn, modifier = Modifier.fillMaxWidth(), onClick = on.signIn)
                    } else {
                        Secondary("Sign out", modifier = Modifier.fillMaxWidth(), onClick = model::signOut)
                    }
                    StatusLine(state.lines[Line.ACCOUNT])
                }

                Title("Buddy", Modifier.section("buddy"))
                // Settings can stay open: the heads turn for a few seconds on opening, then rest facing front.
                BuddyPicker(state.characterId, onPick = { if (model.pick(it)) on.lookChanged() }, turnFor = 5.seconds)
                Group {
                    Row(Modifier.rowPadding(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Name", Modifier.weight(1f))
                        OutlinedTextField(
                            value = state.name,
                            onValueChange = model::setName,
                            modifier = Modifier.widthIn(max = 200.dp),
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                            shape = ROUNDED,
                        )
                    }
                    Hairline()
                    Row(Modifier.rowPadding(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Size", Modifier.weight(1f))
                        Segmented(SIZES, state.size, onSelect = {
                            model.setSize(it)
                            on.lookChanged()
                        }, role = Role.RadioButton, modifier = Modifier.widthIn(max = 220.dp))
                    }
                    Hairline()
                    Row(Modifier.rowPadding(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text("Buddy on")
                            when {
                                state.buddyOn && !allowed.float -> Text(
                                    "Let Buddy float: allow Display over other apps.",
                                    color = Buddy.colors.error,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                else -> Text(
                                    if (state.buddyOn) "Your buddy is on, and comes back every time your phone starts." else "Your buddy is off.",
                                    color = Buddy.colors.muted,
                                    style = MaterialTheme.typography.bodySmall,
                                )
                            }
                        }
                        Switch(
                            checked = state.buddyOn,
                            onCheckedChange = { wanted ->
                                if (model.setBuddyOn(wanted, canFloat = context.allowed().float)) on.powerChanged(wanted) else context.openFloatSettings()
                            },
                            colors = SwitchDefaults.colors(checkedTrackColor = Buddy.colors.accent, checkedThumbColor = Buddy.colors.accentFg),
                        )
                    }
                }
                StatusLine(state.lines[Line.BUDDY])

                Title("AI", Modifier.section("ai"))
                val freeMode = aiSection(free)
                if (freeMode.note.isNotEmpty()) Note(freeMode.note)
                if (freeMode.showForm) Card { AiForm(ai) }

                Title("Permissions", Modifier.section("permissions"))
                Group {
                    PermissionRow("Display over other apps", "Float over your apps, so you can tap Buddy anywhere.", allowed.float) {
                        context.openFloatSettings()
                    }
                    Hairline()
                    PermissionRow("Notifications", "Show that Buddy is on, with Turn off.", allowed.notifications, on.askNotifications)
                }

                Text(
                    "Buddy ${BuildConfig.VERSION_NAME}",
                    Modifier.fillMaxWidth().padding(top = 12.dp),
                    color = Buddy.colors.muted,
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

@Composable
private fun Title(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(top = 14.dp), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
}

/** A card on the window's grey, as the Mac's .card. */
@Composable
private fun Card(content: @Composable ColumnScope.() -> Unit) {
    val colors = Buddy.colors
    val shape = RoundedCornerShape(BuddyRadius)
    Column(
        Modifier.fillMaxWidth().background(colors.card, shape).border(1.dp, colors.lineSoft, shape).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

/** Rows on one card, each with its title on the left and its control on the right, as the Mac's .group. */
@Composable
private fun Group(content: @Composable ColumnScope.() -> Unit) {
    val colors = Buddy.colors
    val shape = RoundedCornerShape(BuddyRadius)
    Column(Modifier.fillMaxWidth().background(colors.card, shape).border(1.dp, colors.lineSoft, shape), content = content)
}

@Composable
private fun Hairline() {
    HorizontalDivider(Modifier.padding(horizontal = 14.dp), thickness = 1.dp, color = Buddy.colors.lineSoft)
}

private fun Modifier.rowPadding() = fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 14.dp, vertical = 8.dp)

/** Who is signed in: the initials in a teal circle, the name and the email. Signed out, a grey figure and what to do. */
@Composable
private fun AccountRow(user: User?) {
    val colors = Buddy.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(user)
        Column(Modifier.weight(1f)) {
            val name = user?.let { it.name.ifEmpty { it.email } } ?: "Not signed in"
            val second = when {
                user == null -> "Sign in with Google to use your buddy."
                user.name.isNotEmpty() -> user.email
                else -> ""
            }
            Text(name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (second.isNotEmpty()) {
                Text(
                    second,
                    color = colors.muted,
                    style = MaterialTheme.typography.bodySmall,
                    // Signed out, the second line says what to do: it wraps rather than being cut short.
                    maxLines = if (user == null) Int.MAX_VALUE else 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun Avatar(user: User?) {
    val size = Modifier.size(44.dp)
    if (user == null) {
        Canvas(size) {
            drawCircle(Brush.verticalGradient(listOf(Color(0xFFB4B4BA), Color(0xFF8E8E94))))
            val figure = Color.White.copy(alpha = 0.92f)
            drawCircle(figure, radius = this.size.width * 0.17f, center = Offset(center.x, this.size.height * 0.39f))
            drawArc(
                figure, 180f, 180f, useCenter = true,
                topLeft = Offset(this.size.width * 0.17f, this.size.height * 0.62f),
                size = Size(this.size.width * 0.66f, this.size.height * 0.6f),
            )
        }
        return
    }
    Box(
        size.background(Brush.verticalGradient(listOf(Color(0xFF2F9D90), Color(0xFF1B6D64))), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials(user.name, user.email), color = Color.White, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}

/** Allowed or not: "Allowed ✓" in green, else the button that asks for it. */
@Composable
private fun PermissionRow(title: String, what: String, granted: Boolean, allow: () -> Unit) {
    Row(Modifier.rowPadding(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title)
            Text(what, color = Buddy.colors.muted, style = MaterialTheme.typography.bodySmall)
        }
        if (granted) Text("Allowed ✓", color = Buddy.colors.good, fontWeight = FontWeight.Medium) else Secondary("Allow", onClick = allow)
    }
}
