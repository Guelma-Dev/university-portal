package dz.guelma.portal;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RadialGradient;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.View;

/**
 * Static splash background: the navy radial gradient from nova.css plus a
 * masked blueprint dot grid. Nothing here animates — it is drawn once.
 */
public class PortalDotGridView extends View {

    private final Paint bgPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dotPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private float cx;
    private float cy;
    private float rx;
    private float ry;
    private float step;
    private float radius;

    public PortalDotGridView(Context context) {
        super(context);
        init(context);
    }

    public PortalDotGridView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context);
    }

    private void init(Context context) {
        dotPaint.setStyle(Paint.Style.FILL);
        dotPaint.setColor(0xFFBFD9FF);
        float density = context.getResources().getDisplayMetrics().density;
        step = 22f * density;   // background-size: 22px 22px
        radius = 1.2f * density;
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);
        // radial-gradient(120% 120% at 50% 20%, #101828 0%, #0B0E14 60%)
        cx = w / 2f;
        cy = h * 0.45f;
        rx = w * 0.75f;
        ry = h * 0.65f;
        bgPaint.setShader(new RadialGradient(cx, h * 0.20f, Math.max(w, h) * 1.2f,
                0xFF101828, 0xFF0B0E14, Shader.TileMode.CLAMP));
    }

    @Override
    protected void onDraw(Canvas canvas) {
        int w = getWidth();
        int h = getHeight();
        canvas.drawRect(0f, 0f, w, h, bgPaint);

        // mask-image: radial-gradient(75% 65% at 50% 45%, #000 35%, transparent 100%)
        for (float x = step / 2f; x < w; x += step) {
            float dx = (x - cx) / rx;
            for (float y = step / 2f; y < h; y += step) {
                float dy = (y - cy) / ry;
                float d = (float) Math.sqrt(dx * dx + dy * dy);
                float fade = d <= 0.35f ? 1f : 1f - (d - 0.35f) / 0.65f;
                if (fade <= 0f) continue;
                dotPaint.setAlpha((int) (26f * fade)); // rgba(191,217,255,.10)
                canvas.drawCircle(x, y, radius, dotPaint);
            }
        }
    }
}
