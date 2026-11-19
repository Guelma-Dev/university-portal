package dz.guelma.portal;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PathMeasure;
import android.graphics.RectF;
import android.util.AttributeSet;
import android.view.View;

/**
 * The 64x64 portal logo, drawn on a hardware-accelerated Canvas.
 *
 * Every Path and PathMeasure is created once in onSizeChanged(). The single
 * timeline writes one number (t); onDraw only resets two pre-allocated segment
 * paths and asks PathMeasure for a partial segment. No Path, Paint or Shader is
 * ever allocated per frame, and invalidate() touches this 148dp view only.
 */
public class PortalLogoDrawView extends View {

    private final Paint linePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint anchorPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint capPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bandPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bookPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint tasselPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint spinePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint penPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF tasselRect = new RectF(54.8f, 21f, 57.4f, 35.5f);

    private final Path capPath = new Path();
    private final Path bookPath = new Path();
    private final Path bandPath = new Path();
    private final Path bookFillPath = new Path();
    private final Path anchorPath = new Path();
    private final Path segCap = new Path();
    private final Path segBook = new Path();

    private PathMeasure capMeasure;
    private PathMeasure bookMeasure;
    private PathMeasure segMeasure;
    private float capLength;
    private float bookLength;

    private float t;
    private final float[] penPos = new float[2];
    private final float[] penTangent = new float[2];

    public PortalLogoDrawView(Context context) {
        super(context);
        init();
    }

    public PortalLogoDrawView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    private void init() {
        setLayerType(View.LAYER_TYPE_NONE, null); // keep the GPU path renderer, no software bitmap

        linePaint.setStyle(Paint.Style.STROKE);
        linePaint.setStrokeWidth(2f);            // 64-unit space -> ~4.6dp on the 148dp stage
        linePaint.setStrokeCap(Paint.Cap.ROUND);
        linePaint.setStrokeJoin(Paint.Join.ROUND);
        linePaint.setColor(0xFFD9A93F); // gold outline, swapped to cream for the book

        // Exact palette of the original brand-mark (assets/logo.svg).
        anchorPaint.setStyle(Paint.Style.FILL);
        anchorPaint.setColor(0xFFD9A93F);

        bandPaint.setStyle(Paint.Style.FILL);
        bandPaint.setColor(0xFFF4F1EA);

        capPaint.setStyle(Paint.Style.FILL);
        capPaint.setColor(0xFFD9A93F);

        bookPaint.setStyle(Paint.Style.FILL);
        bookPaint.setColor(0xFFF4F1EA);

        tasselPaint.setStyle(Paint.Style.FILL);
        tasselPaint.setColor(0xFFA87B22);

        spinePaint.setStyle(Paint.Style.STROKE);
        spinePaint.setStrokeWidth(2.1f);
        spinePaint.setStrokeCap(Paint.Cap.ROUND);
        spinePaint.setColor(0xFFA87B22);

        penPaint.setStyle(Paint.Style.FILL);
        penPaint.setColor(0xFFF4F1EA);

        segMeasure = new PathMeasure();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        super.onSizeChanged(w, h, oldw, oldh);

        // Cap outline: M32 9 L58 21 L32 33 L6 21 Z
        capPath.reset();
        capPath.moveTo(32f, 9f);
        capPath.lineTo(58f, 21f);
        capPath.lineTo(32f, 33f);
        capPath.lineTo(6f, 21f);
        capPath.close();

        // Book outline: M10 43 C17 39 25 39 32 43 C39 39 47 39 54 43 L54 53 ...
        bookPath.reset();
        bookPath.moveTo(10f, 43f);
        bookPath.cubicTo(17f, 39f, 25f, 39f, 32f, 43f);
        bookPath.cubicTo(39f, 39f, 47f, 39f, 54f, 43f);
        bookPath.lineTo(54f, 53f);
        bookPath.cubicTo(47f, 49f, 39f, 49f, 32f, 53f);
        bookPath.cubicTo(25f, 49f, 17f, 49f, 10f, 53f);
        bookPath.close();

        // Cap band: M22 27.5 L22 34.3 C22 39.5 42 39.5 42 34.3 L42 27.5 L32 31.7 Z
        bandPath.reset();
        bandPath.moveTo(22f, 27.5f);
        bandPath.lineTo(22f, 34.3f);
        bandPath.cubicTo(22f, 39.5f, 42f, 39.5f, 42f, 34.3f);
        bandPath.lineTo(42f, 27.5f);
        bandPath.lineTo(32f, 31.7f);
        bandPath.close();

        // Book fill: the df-sp-fill path, offset 0.5 down from the outline.
        bookFillPath.reset();
        bookFillPath.moveTo(10f, 43.5f);
        bookFillPath.cubicTo(17f, 39.9f, 25f, 39.9f, 32f, 43.5f);
        bookFillPath.cubicTo(39f, 39.9f, 47f, 39.9f, 54f, 43.5f);
        bookFillPath.lineTo(54f, 53f);
        bookFillPath.cubicTo(47f, 49.4f, 39f, 49.4f, 32f, 53f);
        bookFillPath.cubicTo(25f, 49.4f, 17f, 49.4f, 10f, 53f);
        bookFillPath.close();

        // Six 4x4 anchors, centred on the specified points.
        anchorPath.reset();
        float[] anchors = {32f, 9f, 58f, 21f, 32f, 33f, 6f, 21f, 10f, 43f, 54f, 43f};
        for (int i = 0; i < anchors.length; i += 2) {
            anchorPath.addRect(anchors[i] - 2f, anchors[i + 1] - 2f,
                    anchors[i] + 2f, anchors[i + 1] + 2f, Path.Direction.CW);
        }

        capMeasure = new PathMeasure(capPath, false);
        bookMeasure = new PathMeasure(bookPath, false);
        capLength = capMeasure.getLength();
        bookLength = bookMeasure.getLength();
    }

    /** The only input to the whole drawing: one number from the shared timeline. */
    public void setProgress(float value) {
        if (t == value) return;
        t = value;
        invalidate(); // this 148dp view only — never the full-screen overlay
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);

        float scale = Math.min(getWidth(), getHeight()) / 64f;
        canvas.save();
        canvas.translate((getWidth() - 64f * scale) / 2f, (getHeight() - 64f * scale) / 2f);
        canvas.scale(scale, scale);

        // Strokes are revealed piece by piece with one PathMeasure per outline.
        float capP = sub(0.03f, 0.40f, t);
        float bookP = sub(0.34f, 0.62f, t);
        linePaint.setColor(0xFFD9A93F);
        drawPartial(capMeasure, capLength, capP, segCap, capPath, canvas);
        linePaint.setColor(0xFFF4F1EA);
        drawPartial(bookMeasure, bookLength, bookP, segBook, bookPath, canvas);

        // Small pen dot at the leading edge of the stroke currently being drawn.
        if (t > 0.02f && t < 0.64f) {
            boolean onCap = capP < 1f;
            float p = onCap ? capP : bookP;
            Path target = onCap ? segCap : segBook;
            if (p > 0f && p < 1f) {
                segMeasure.setPath(target, false);
                float segLen = segMeasure.getLength();
                if (segLen > 0f && segMeasure.getPosTan(segLen, penPos, penTangent)) {
                    penPaint.setAlpha((int) (255f * Math.min(1f, p * 8f)));
                    canvas.drawCircle(penPos[0], penPos[1], 1.4f, penPaint);
                }
            }
        }

        // Anchors ride with the strokes, then fade out as the fills land.
        float anchorAlpha = t < 0.62f ? sub(0.02f, 0.09f, t) : 1f - sub(0.62f, 0.74f, t);
        if (anchorAlpha > 0f) {
            anchorPaint.setAlpha((int) (255f * anchorAlpha));
            canvas.drawPath(anchorPath, anchorPaint);
        }

        // Staggered fills in the original brand colours: cap -> band -> book.
        float capF = sub(0.62f, 0.78f, t);
        if (capF > 0f) {
            capPaint.setAlpha((int) (255f * capF));
            canvas.drawPath(capPath, capPaint);
        }
        float bandF = sub(0.67f, 0.83f, t);
        if (bandF > 0f) {
            bandPaint.setAlpha((int) (255f * bandF));
            canvas.drawPath(bandPath, bandPaint);
        }
        float bookF = sub(0.72f, 0.90f, t);
        if (bookF > 0f) {
            bookPaint.setAlpha((int) (255f * bookF));
            canvas.drawPath(bookFillPath, bookPaint);
        }

        // The two details that make it the ORIGINAL logo: tassel + book spine.
        float tasselA = sub(0.64f, 0.78f, t);
        if (tasselA > 0f) {
            int a = (int) (255f * tasselA);
            tasselPaint.setAlpha(a);
            canvas.drawRoundRect(tasselRect, 1.3f, 1.3f, tasselPaint);
            canvas.drawCircle(56.1f, 38.2f, 3.1f, tasselPaint);
        }
        float spineA = sub(0.72f, 0.86f, t);
        if (spineA > 0f) {
            spinePaint.setAlpha((int) (255f * spineA));
            canvas.drawLine(32f, 43.5f, 32f, 53f, spinePaint);
        }

        canvas.restore();
    }

    private void drawPartial(PathMeasure measure, float length, float p,
                                    Path segment, Path full, Canvas canvas) {
        if (p <= 0f) return;
        if (p >= 1f) {
            canvas.drawPath(full, linePaint);
            return;
        }
        segment.reset();
        measure.getSegment(0f, length * p, segment, true);
        canvas.drawPath(segment, linePaint);
    }

    private static float sub(float a, float b, float t) {
        if (t <= a) return 0f;
        if (t >= b) return 1f;
        float x = (t - a) / (b - a);
        return x * x * (3f - 2f * x); // smoothstep
    }
}
