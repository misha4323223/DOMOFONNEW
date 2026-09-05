import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api";
import { colors } from "../theme";
import { checkForUpdate, downloadAndRestart } from "../updates";
import { getMyProfile, saveMyProfile } from "../profile";

interface Props {
  onLogin: (token: string) => void;
}

export function LoginScreen({ onLogin }: Props) {
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Подставляем профиль с прошлого входа
  useEffect(() => {
    (async () => {
      const saved = await getMyProfile();
      if (saved.city) setCity(saved.city);
      if (saved.address) setAddress(saved.address);
    })();
  }, []);

  const submit = async () => {
    const trimmedCity = city.trim();
    if (!trimmedCity || busy) {
      if (!trimmedCity) setError("Введите город — он подписывается под сообщениями");
      return;
    }
    if (!password.trim()) {
      setError("Введите пароль");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(password.trim());
      await saveMyProfile({ city: trimmedCity, address: address.trim() });
      onLogin(res.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  };

  // Ручная проверка OTA-обновлений
  const checkUpdate = async () => {
    if (checkingUpdate) return;
    setCheckingUpdate(true);
    try {
      const status = await checkForUpdate();
      if (status === "available") {
        const applied = await downloadAndRestart();
        if (!applied) {
          Alert.alert("Обновление", "Не удалось применить обновление");
        }
      } else if (status === "none") {
        Alert.alert("Обновление", "Установлена актуальная версия");
      } else if (status === "unsupported") {
        Alert.alert(
          "Обновление",
          "Проверка доступна только в собранном приложении",
        );
      } else {
        Alert.alert("Обновление", "Не удалось проверить — проверьте интернет");
      }
    } finally {
      setCheckingUpdate(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Домофонная служба</Text>
          <Text style={styles.subtitle}>Админка</Text>

          <TextInput
            style={styles.input}
            placeholder="Город"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            value={city}
            onChangeText={setCity}
            returnKeyType="next"
          />

          <TextInput
            style={styles.input}
            placeholder="Улица, дом, подъезд"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            value={address}
            onChangeText={setAddress}
            returnKeyType="next"
          />

          <TextInput
            style={styles.input}
            placeholder="Пароль"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            returnKeyType="go"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [
              styles.button,
              pressed && { opacity: 0.85 },
            ]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.buttonText}>Войти</Text>
            )}
          </Pressable>
        </View>

        <Pressable onPress={checkUpdate} hitSlop={10} style={styles.updateLink}>
          {checkingUpdate ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Text style={styles.updateLinkText}>🔄 Проверить обновление</Text>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  kav: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  updateLink: {
    marginTop: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  updateLinkText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 24,
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: "center",
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  error: {
    color: colors.destructive,
    fontSize: 14,
    textAlign: "center",
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  buttonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "700",
  },
});
