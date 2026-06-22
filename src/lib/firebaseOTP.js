import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth'
import { auth } from './firebase'

export const setupRecaptcha = () => {
  if (window.recaptchaVerifier) {
    try { window.recaptchaVerifier.clear() } catch (e) {}
    window.recaptchaVerifier = null
  }

  window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    size: 'invisible',
  })

  return window.recaptchaVerifier
}

export const sendFirebaseOTP = async (phoneNumber) => {
  try {
    const appVerifier = setupRecaptcha()
    const fullPhone = '+91' + phoneNumber

    const confirmationResult = await signInWithPhoneNumber(auth, fullPhone, appVerifier)
    window.confirmationResult = confirmationResult

    return { success: true }
  } catch (error) {
    console.error('Firebase OTP error:', error)
    try {
      window.recaptchaVerifier?.clear()
      window.recaptchaVerifier = null
    } catch (e) {}
    return { success: false, error: error.message }
  }
}

export const verifyFirebaseOTP = async (otp) => {
  try {
    if (!window.confirmationResult) {
      return { success: false, error: 'Session expire — dobara OTP bhejo' }
    }

    const result = await window.confirmationResult.confirm(otp)
    return { success: true, firebaseUser: result.user }
  } catch (error) {
    return { success: false, error: 'Galat OTP — dobara try karo' }
  }
}
