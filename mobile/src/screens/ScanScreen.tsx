import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as FileSystem from "expo-file-system/legacy";
import { api, type LeadCandidate } from "../api";
import { colors } from "../theme";

interface Props {
  token: string;
  onResult: (candidates: LeadCandidate[], fullText: string) => void;
  onBack: () => void;
}

export function ScanScreen({ token, onResult, onBack }: Props) {
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!photo) throw new Error("Не удалось сделать фото");

      const base64 = await FileSystem.readAsStringAsync(photo.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const result = await api.scan(token, base64, "JPEG");
      onResult(result.candidates ?? [], result.fullText ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось распознать страницу");
    } finally {
      setBusy(false);
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.title}>Нужен доступ к камере</Text>
          <Text style={styles.hint}>
            Чтобы сфотографировать блокнот с заявками, разрешите доступ к камере
          </Text>
          <Pressable style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Разрешить</Text>
          </Pressable>
          <Pressable style={styles.ghostButton} onPress={onBack}>
            <Text style={styles.ghostButtonText}>Назад</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={false}
      >
        <View style={styles.overlay}>
          <Text style={styles.overlayHint}>
            Сфотографируйте страницу блокнота целиком, ровно и при хорошем свете
          </Text>
        </View>
      </CameraView>

      <View style={styles.controls}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [
            styles.primaryButton,
            busy && { opacity: 0.6 },
            pressed && { opacity: 0.85 },
          ]}
          onPress={capture}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={styles.primaryButtonText}>📸 Сфотографировать</Text>
          )}
        </Pressable>
        <Pressable style={styles.ghostButton} onPress={onBack} disabled={busy}>
          <Text style={styles.ghostButtonText}>Отмена</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  camera: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 16,
  },
  overlayHint: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    overflow: "hidden",
  },
  controls: {
    padding: 16,
    gap: 10,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  hint: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryButtonText: {
    color: colors.primaryForeground,
    fontSize: 16,
    fontWeight: "700",
  },
  ghostButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  ghostButtonText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "600",
  },
  error: {
    color: colors.destructive,
    fontSize: 13,
    textAlign: "center",
  },
});