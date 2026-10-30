import { Stack } from 'expo-router';
import { Platform, useColorScheme } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  const dark = useColorScheme() === 'dark';
  const bg = Platform.OS === 'web' ? 'transparent' : dark ? '#201E1D' : '#F3F2F2';
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: bg } }} />
    </>
  );
}
