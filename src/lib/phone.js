// Valid Indian mobile: 10 digits, starts with 6-9 (TRAI numbering plan).
export const isValidIndianMobile = (n) => /^[6-9]\d{9}$/.test(n || '');
