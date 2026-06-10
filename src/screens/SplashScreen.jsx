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
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '20px',
          padding: '20px 28px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}>
          <img src="/logo.png" alt="MedSetu Logo" style={{ width: '180px', height: 'auto', display: 'block' }} />
        </div>
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
