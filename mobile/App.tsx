import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { LoginScreen } from "./src/screens/LoginScreen";
import { LeadsScreen } from "./src/screens/LeadsScreen";
import { LeadFormScreen } from "./src/screens/LeadFormScreen";
import { api, type Lead } from "./src/api";
import { colors } from "./src/theme";

const TOKEN_KEY = "admin_token";

// Показываем уведомления, когда приложение открыто
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type Screen =
  | { name: "leads" }
  | { name: "form"; lead: Lead | null };

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<Screen>({ name: "leads" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        setToken(saved);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleLogin = async (newToken: string) => {
    await AsyncStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setScreen({ name: "leads" });
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setScreen({ name: "leads" });
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!token) {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <LoginScreen onLogin={handleLogin} />
      </View>
    );
  }

  if (screen.name === "form") {
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <LeadFormScreen
          token={token}
          lead={screen.lead}
          onSaved={() => {
            setReloadKey((k) => k + 1);
            setScreen({ name: "leads" });
          }}
          onBack={() => setScreen({ name: "leads" })}
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <LeadsScreen
        key={reloadKey}
        token={token}
        onLogout={handleLogout}
        onAdd={() => setScreen({ name: "form", lead: null })}
        onEdit={(lead) => setScreen({ name: "form", lead })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
});
