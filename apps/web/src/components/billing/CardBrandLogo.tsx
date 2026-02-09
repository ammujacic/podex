'use client';

/**
 * Card brand logo component - renders SVG logos for payment card brands
 */
export function CardBrandLogo({ brand }: { brand: string }) {
  const brandLower = brand?.toLowerCase() || '';

  switch (brandLower) {
    case 'visa':
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="#1A1F71" />
          <path
            d="M19.5 21H17L18.75 11H21.25L19.5 21ZM15.25 11L12.85 17.9L12.55 16.45L12.55 16.45L11.65 12C11.65 12 11.55 11 10.25 11H6.05L6 11.15C6 11.15 7.45 11.45 9.15 12.55L11.35 21H14L18 11H15.25ZM35 21H37.5L35.35 11H33.35C32.25 11 31.95 11.85 31.95 11.85L27.85 21H30.55L31.1 19.5H34.45L34.75 21H35ZM31.95 17.4L33.35 13.65L34.15 17.4H31.95ZM28.65 13.75L29.05 11.35C29.05 11.35 27.75 10.85 26.4 10.85C24.95 10.85 21.55 11.5 21.55 14.45C21.55 17.2 25.35 17.25 25.35 18.65C25.35 20.05 21.95 19.7 20.75 18.75L20.3 21.25C20.3 21.25 21.65 21.85 23.55 21.85C25.45 21.85 28.6 20.8 28.6 18.1C28.6 15.3 24.75 15.05 24.75 13.9C24.75 12.75 27.45 12.9 28.65 13.75Z"
            fill="white"
          />
        </svg>
      );
    case 'mastercard':
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="#000000" />
          <circle cx="18" cy="16" r="8" fill="#EB001B" />
          <circle cx="30" cy="16" r="8" fill="#F79E1B" />
          <path
            d="M24 9.6C26.1 11.2 27.5 13.5 27.5 16C27.5 18.5 26.1 20.8 24 22.4C21.9 20.8 20.5 18.5 20.5 16C20.5 13.5 21.9 11.2 24 9.6Z"
            fill="#FF5F00"
          />
        </svg>
      );
    case 'amex':
    case 'american express':
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="#006FCF" />
          <path
            d="M9 20V12H13.5L14.3 13.5L15.1 12H42V19.2C42 19.2 41.2 20 40.2 20H25.8L24.8 18.8V20H21.5V18.2C21.5 18.2 21 18.5 20 18.5H19V20H14.2L13.4 18.5L12.6 20H9ZM10 13V19H12.8L13.5 17.5L14.2 19H16L14 16L16 13H14.2L13.5 14.5L12.8 13H10ZM10.8 14.2H12.2L13.5 17L12.2 14.2ZM16.5 13V19H18V16.5H19.5C20.8 16.5 21.8 15.8 21.8 14.5C21.8 13.5 21 13 20 13H16.5ZM18 14.2H19.8C20.2 14.2 20.5 14.5 20.5 14.8C20.5 15.2 20.2 15.5 19.8 15.5H18V14.2ZM22 13V19H24V17.2H24.5L26 19H28L26.2 17C27 16.8 27.5 16.2 27.5 15.2C27.5 14 26.5 13 25.2 13H22ZM23.5 14.2H25C25.5 14.2 25.8 14.5 25.8 15C25.8 15.5 25.5 15.8 25 15.8H23.5V14.2ZM28 13V19H33V17.8H29.5V16.5H32.8V15.2H29.5V14.2H33V13H28ZM33.5 17.8V19H38.5C39.5 19 40 18.5 40 17.8V17C40 16.3 39.5 16 38.8 16C39.5 16 40 15.5 40 14.8V14.2C40 13.5 39.5 13 38.5 13H33.5V14.2H38C38.3 14.2 38.5 14.4 38.5 14.7C38.5 15 38.3 15.2 38 15.2H33.5V16.5H38C38.3 16.5 38.5 16.7 38.5 17C38.5 17.3 38.3 17.5 38 17.5H33.5V17.8Z"
            fill="white"
          />
        </svg>
      );
    case 'discover':
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="#FF6600" />
          <ellipse cx="28" cy="16" rx="7" ry="6" fill="white" />
          <path
            d="M7 13H10C11.5 13 12.5 14 12.5 15.5C12.5 17 11.5 18 10 18H8.5V20H7V13ZM8.5 14.2V16.8H9.8C10.5 16.8 11 16.3 11 15.5C11 14.7 10.5 14.2 9.8 14.2H8.5Z"
            fill="white"
          />
          <path d="M13 13H14.5V20H13V13Z" fill="white" />
          <path
            d="M15.5 17.5C15.8 18.5 16.8 19 18 19C19.5 19 20.5 18 20.5 16.5C20.5 15 19.5 14.2 18.2 14.2C17.5 14.2 17 14.5 17 14.5V13H20.5V11.8H15.5V16C15.5 16 16 15.2 17.5 15.2C18.5 15.2 19 15.8 19 16.5C19 17.2 18.5 17.8 17.8 17.8C17 17.8 16.5 17.3 16.3 16.5L15.5 17.5Z"
            fill="white"
          />
        </svg>
      );
    case 'diners':
    case 'diners club':
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="#0079BE" />
          <circle cx="24" cy="16" r="9" fill="white" />
          <path d="M20 11V21C17.5 20 16 18.2 16 16C16 13.8 17.5 12 20 11Z" fill="#0079BE" />
          <path d="M28 11V21C30.5 20 32 18.2 32 16C32 13.8 30.5 12 28 11Z" fill="#0079BE" />
        </svg>
      );
    case 'jcb':
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="white" />
          <rect x="8" y="6" width="10" height="20" rx="2" fill="#0E4C96" />
          <rect x="19" y="6" width="10" height="20" rx="2" fill="#E41B24" />
          <rect x="30" y="6" width="10" height="20" rx="2" fill="#007940" />
          <path d="M11 12H15V16H11V12Z" fill="white" />
          <path d="M22 12H26V16H22V12Z" fill="white" />
          <path d="M33 12H37V16H33V12Z" fill="white" />
        </svg>
      );
    case 'unionpay':
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="#FFFFFF" />
          <path d="M8 8H18L22 24H12L8 8Z" fill="#E21836" />
          <path d="M16 8H28L32 24H20L16 8Z" fill="#00447C" />
          <path d="M26 8H40L36 24H22L26 8Z" fill="#007B84" />
        </svg>
      );
    default:
      // Generic card icon for unknown brands
      return (
        <svg
          viewBox="0 0 48 32"
          className="w-10 h-7"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="48" height="32" rx="4" fill="#374151" />
          <rect x="6" y="10" width="36" height="3" rx="1" fill="#6B7280" />
          <rect x="6" y="16" width="12" height="2" rx="1" fill="#6B7280" />
          <rect x="6" y="20" width="8" height="2" rx="1" fill="#6B7280" />
        </svg>
      );
  }
}
