import Link from 'next/link';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  href?: string;
}

const sizes = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl',
};

export function Logo({ size = 'md', href = '/' }: LogoProps) {
  const textSize = sizes[size];

  const content = (
    <span
      className={`${textSize} font-bold text-text-primary tracking-wider`}
      style={{ fontFamily: 'var(--font-logo), sans-serif' }}
    >
      PODEX
    </span>
  );

  if (href) {
    return (
      <Link href={href} className="inline-block">
        {content}
      </Link>
    );
  }

  return content;
}
