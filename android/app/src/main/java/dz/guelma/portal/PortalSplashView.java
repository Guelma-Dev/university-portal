package dz.guelma.portal;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.ForegroundColorSpan;
import android.text.style.StyleSpan;
import android.util.AttributeSet;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.PathInterpolator;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Full-screen native splash overlay. Added over MainActivity's WebView in
 * onCreate — the WebView loads underneath in parallel — and removed by
 * NativeSplash.hide() (JS readiness) or by the 6s failsafe, whichever comes
 * first. A single ValueAnimator drives one number, t, for the whole sequence.
 */
public class PortalSplashView extends FrameLayout {

    private static final long TIMELINE_MS = 2600L;
    private static final long FAILSAFE_MS = 6000L;
    // Matches the CSS ending: stage swallows to scale(8) while the splash fades.
    private static final long FADE_MS = 560L;

    private static PortalSplashView active;

    private final PortalLogoDrawView logo;
    private final TextView word;
    private final ValueAnimator animator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable failsafe = new Runnable() {
        @Override public void run() { hide(); }
    };
    private final float density;

    private boolean hidden;

    public PortalSplashView(Context context) {
        super(context);
        density = context.getResources().getDisplayMetrics().density;
        setClickable(true);   // swallow touches while the overlay is up
        setFocusable(true);
        setClipChildren(false); // let the final scale(8) swallow run past the box

        addView(new PortalDotGridView(context), new LayoutParams(
                LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));

        int stage = Math.round(148f * density);
        LinearLayout box = new LinearLayout(context);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER_HORIZONTAL);
        box.setClipChildren(false);

        logo = new PortalLogoDrawView(context);
        box.addView(logo, new LinearLayout.LayoutParams(stage, stage));

        word = new TextView(context);
        String text = "بوابة الطالب";
        SpannableString styled = new SpannableString(text);
        int em = text.indexOf("الطالب");
        styled.setSpan(new ForegroundColorSpan(0xFFD9A93F), em, em + 6,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        styled.setSpan(new StyleSpan(Typeface.ITALIC), em, em + 6,
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        word.setText(styled);
        word.setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f);
        word.setTextColor(0xFFF4F1EA);
        word.setAlpha(0f);
        LinearLayout.LayoutParams wordParams =
                new LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        wordParams.topMargin = Math.round(6f * density);
        box.addView(word, wordParams);

        addView(box, new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT,
                Gravity.CENTER));

        animator = ValueAnimator.ofFloat(0f, 1f);
        animator.setDuration(TIMELINE_MS);
        animator.setInterpolator(new LinearInterpolator());
        animator.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override public void onAnimationUpdate(ValueAnimator a) {
                apply((Float) a.getAnimatedValue());
            }
        });

        active = this;
    }

    public PortalSplashView(Context context, AttributeSet attrs) {
        this(context);
    }

    @Override
    protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        active = this;
        handler.postDelayed(failsafe, FAILSAFE_MS);
        animator.start();
    }

    @Override
    protected void onDetachedFromWindow() {
        handler.removeCallbacks(failsafe);
        if (animator.isRunning()) animator.cancel();
        if (active == this) active = null;
        super.onDetachedFromWindow();
    }

    /** One timeline value updates the logo canvas and the single wordmark. */
    private void apply(float t) {
        logo.setProgress(t);                    // the only view that invalidates itself

        float wordA = sub(0.78f, 0.92f, t);
        word.setAlpha(wordA);
        word.setTranslationY((1f - wordA) * 14f * density);
    }

    /** Idempotent: JS readiness and the failsafe can race safely. */
    public void hide() {
        if (hidden) return;
        hidden = true;
        handler.removeCallbacks(failsafe);
        if (animator.isRunning()) animator.cancel();

        if (getParent() == null) {
            if (active == this) active = null;
            return;
        }
        // The original CSS exits with a "swallow": the wordmark lifts away and
        // the whole stage zooms to 8x while the splash fades into the app.
        word.animate().alpha(0f).translationY(-6f * density)
                .setDuration(220L).start();
        logo.animate().scaleX(8f).scaleY(8f).alpha(0f)
                .setDuration(FADE_MS)
                .setInterpolator(new PathInterpolator(0.4f, 0f, 1f, 1f))
                .start();
        animate().alpha(0f)
                .setDuration(FADE_MS)
                .setInterpolator(new DecelerateInterpolator())
                .withEndAction(new Runnable() {
                    @Override public void run() {
                        if (active == PortalSplashView.this) active = null;
                        ViewGroup parent = (ViewGroup) getParent();
                        if (parent != null) parent.removeView(PortalSplashView.this);
                    }
                })
                .start();
    }

    public static void hideActive() {
        PortalSplashView splash = active;
        if (splash != null) splash.hide();
    }

    private static float sub(float a, float b, float t) {
        if (t <= a) return 0f;
        if (t >= b) return 1f;
        float x = (t - a) / (b - a);
        return x * x * (3f - 2f * x);
    }
}
