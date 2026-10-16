import { I18nManager, useColorScheme } from 'react-native';

const light = { bg: '#EEF3F1', card: '#FFFFFF', ink: '#12302A', mute: '#587069', line: '#D6E1DC', teal: '#0E5F55', onTeal: '#FFFFFF', gold: '#F2B635', onGold: '#352600', tile: '#E3EDE9', bad: '#B93524', badbg: '#FBE6E2', warn: '#7A5500', warnbg: '#FFF0C8', ok: '#0F6B42', okbg: '#DBF1E6', info: '#1B5384', infobg: '#DCEAF6', rush: '#C2410C', rushbg: '#FFE6D5', scrim: 'rgba(0,0,0,0.5)' };
const dark = { bg: '#0E1917', card: '#14231F', ink: '#E6F0EC', mute: '#96ADA6', line: '#28403A', teal: '#1F8A7B', onTeal: '#FFFFFF', gold: '#F2B635', onGold: '#352600', tile: '#1C302B', bad: '#FF8E7C', badbg: '#3A1D19', warn: '#F5CF6B', warnbg: '#3A3016', ok: '#6FD8A5', okbg: '#17352A', info: '#8EC3F0', infobg: '#172F44', rush: '#FFB27A', rushbg: '#3F2412', scrim: 'rgba(0,0,0,0.65)' };

export const useTheme = () => (useColorScheme() === 'dark' ? dark : light);

// الاتجاه العربي يُبنى يدوياً ليعمل بنفس الشكل على أي جهاز بغض النظر عن لغة النظام:
// إذا كان النظام يعكس الاتجاه تلقائياً (isRTL) نستخدم 'row'، وإلا نعكس الصف بأنفسنا.
export const ROW = I18nManager.isRTL ? 'row' : 'row-reverse';
export const TEXT_ALIGN = 'right';
