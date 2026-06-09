import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, FileText, Home } from 'lucide-react';

const slides = [
  {
    Icon: MapPin,
    title: 'Sahi Dukaan Dhundho',
    description: 'Apne paas ke licensed medical stores map pe dekho',
  },
  {
    Icon: FileText,
    title: 'Prescription Upload Karo',
    description: 'Doctor ki parchi upload karo, ghar baithe order karo',
  },
  {
    Icon: Home,
    title: 'Ghar Pe Pao',
    description: 'Home delivery ya store se pickup — aapki marzi',
  },
];

export default function OnboardingScreen() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);

  const goTo = (index) => {
    if (animating || index === current) return;
    setAnimating(true);
    setTimeout(() => {
      setCurrent(index);
      setAnimating(false);
    }, 250);
  };

  const handleNext = () => {
    if (current < slides.length - 1) {
      goTo(current + 1);
    } else {
      navigate('/login');
    }
  };

  const { Icon, title, description } = slides[current];
  const isLast = current === slides.length - 1;

  return (
    <div style={styles.wrapper}>
      <div style={styles.container}>
        {/* Skip button */}
        <button style={styles.skipBtn} onClick={() => navigate('/login')}>
          Skip
        </button>

        {/* Slide content */}
        <div
          style={{
            ...styles.slideContent,
            opacity: animating ? 0 : 1,
            transform: animating ? 'translateY(12px)' : 'translateY(0)',
          }}
        >
          <div style={styles.iconWrapper}>
            <Icon size={80} color="#1A6B3C" strokeWidth={1.5} />
          </div>
          <h2 style={styles.slideTitle}>{title}</h2>
          <p style={styles.slideDesc}>{description}</p>
        </div>

        {/* Dots */}
        <div style={styles.dotsRow}>
          {slides.map((_, i) => (
            <button
              key={i}
              style={{
                ...styles.dot,
                ...(i === current ? styles.dotActive : styles.dotInactive),
              }}
              onClick={() => goTo(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>

        {/* Next / Start button */}
        <button style={styles.primaryBtn} onClick={handleNext}>
          {isLast ? 'Shuru Karein' : 'Aage Badhein'}
        </button>
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: '100vh',
    backgroundColor: '#F5F5F5',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 16px',
  },
  container: {
    width: '100%',
    maxWidth: '480px',
    backgroundColor: '#FFFFFF',
    borderRadius: '24px',
    padding: '40px 32px 48px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    position: 'relative',
    minHeight: '520px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  skipBtn: {
    position: 'absolute',
    top: '20px',
    right: '24px',
    background: 'none',
    border: 'none',
    color: '#666666',
    fontSize: '15px',
    cursor: 'pointer',
    padding: '4px 8px',
    fontFamily: 'inherit',
  },
  slideContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    transition: 'opacity 0.25s ease, transform 0.25s ease',
    marginTop: '32px',
    marginBottom: '32px',
  },
  iconWrapper: {
    width: '140px',
    height: '140px',
    borderRadius: '70px',
    backgroundColor: '#E8F5EE',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '32px',
  },
  slideTitle: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#1A1A1A',
    margin: '0 0 12px',
    lineHeight: '1.3',
  },
  slideDesc: {
    fontSize: '15px',
    color: '#666666',
    lineHeight: '1.6',
    maxWidth: '280px',
    margin: '0',
  },
  dotsRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '28px',
  },
  dot: {
    height: '8px',
    borderRadius: '4px',
    border: 'none',
    cursor: 'pointer',
    padding: '0',
    transition: 'width 0.3s ease, background-color 0.3s ease',
  },
  dotActive: {
    width: '24px',
    backgroundColor: '#1A6B3C',
  },
  dotInactive: {
    width: '8px',
    backgroundColor: '#CCCCCC',
  },
  primaryBtn: {
    width: '100%',
    padding: '16px',
    backgroundColor: '#1A6B3C',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: '600',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'background-color 0.2s ease',
  },
};
