import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function SplashScreen() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => navigate('/onboarding'), 400);
    }, 2500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div style={styles.container}>
      <div style={{ ...styles.content, opacity: visible ? 1 : 0 }}>
        {/* Pill / Capsule Icon */}
        <svg
          width="80"
          height="80"
          viewBox="0 0 80 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={styles.icon}
        >
          <rect
            x="6"
            y="26"
            width="68"
            height="28"
            rx="14"
            stroke="white"
            strokeWidth="4"
            fill="none"
          />
          <line
            x1="40"
            y1="26"
            x2="40"
            y2="54"
            stroke="white"
            strokeWidth="4"
          />
          <rect
            x="6"
            y="26"
            width="34"
            height="28"
            rx="14"
            fill="white"
            fillOpacity="0.25"
          />
        </svg>

        <h1 style={styles.title}>MedSetu</h1>
        <p style={styles.tagline}>Aapki Dawai, Aapke Dwar</p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#1A6B3C',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    transition: 'opacity 0.4s ease',
  },
  icon: {
    marginBottom: '24px',
  },
  title: {
    color: '#FFFFFF',
    fontSize: '42px',
    fontWeight: '700',
    margin: '0',
    letterSpacing: '-0.5px',
  },
  tagline: {
    color: '#FFFFFF',
    fontSize: '16px',
    marginTop: '8px',
    opacity: 0.85,
    fontWeight: '400',
  },
};
