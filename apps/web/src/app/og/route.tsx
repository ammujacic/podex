import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title') || 'Podex';
  const description = searchParams.get('description') || 'Code from anywhere';

  return new ImageResponse(
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#07070a',
        backgroundImage:
          'radial-gradient(circle at 25% 25%, rgba(0, 229, 255, 0.15) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(138, 43, 226, 0.15) 0%, transparent 50%)',
      }}
    >
      {/* Logo area */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 40,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          {/* Logo icon */}
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 20,
              background: 'linear-gradient(135deg, #00e5ff 0%, #8a2be2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" style={{ color: 'white' }}>
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span
            style={{
              fontSize: 64,
              fontWeight: 800,
              background: 'linear-gradient(135deg, #00e5ff 0%, #8a2be2 100%)',
              backgroundClip: 'text',
              color: 'transparent',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Podex
          </span>
        </div>
      </div>

      {/* Title */}
      <div
        style={{
          display: 'flex',
          fontSize: 48,
          fontWeight: 700,
          color: '#ffffff',
          textAlign: 'center',
          maxWidth: 900,
          lineHeight: 1.2,
          marginBottom: 24,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {title}
      </div>

      {/* Description */}
      <div
        style={{
          display: 'flex',
          fontSize: 28,
          color: 'rgba(255, 255, 255, 0.7)',
          textAlign: 'center',
          maxWidth: 800,
          lineHeight: 1.4,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {description}
      </div>

      {/* Bottom tagline */}
      <div
        style={{
          position: 'absolute',
          bottom: 48,
          display: 'flex',
          alignItems: 'center',
          gap: 32,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 20,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <span>🤖</span>
          <span>Multi-Agent AI</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 20,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <span>🧠</span>
          <span>Memory & Planning</span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: 20,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <span>☁️</span>
          <span>Cloud IDE</span>
        </div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
    }
  );
}
