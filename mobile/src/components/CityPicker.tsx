/**
 * Выбор города для маршрута.
 *
 * Нужен потому, что клиенты с сайта часто пишут в адресе только улицу — и карты
 * могут увести в одноимённую улицу другого города. Окно показывается только
 * тогда, когда город не удалось понять из самой заявки; выбранный город
 * запоминается и в следующий раз предлагается первым.
 */
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors } from "../theme";
import {
  SERVICE_CITIES,
  SERVICE_REGION,
  getLastRouteCity,
  leadCity,
  openAddressInNavigator,
  queryWithCity,
  queryWithoutCity,
  rememberRouteCity,
} from "../maps";

interface CityPickerProps {
  visible: boolean;
  /** Адрес заявки — показываем, чтобы свериться перед выбором города. */
  address: string;
  /** Город, который выбирали в прошлый раз (null — ещё не выбирали). */
  lastCity: string | null;
  /** Город выбран; null — «без города», искать по региону. */
  onPick: (city: string | null) => void;
  onCancel: () => void;
}

/** Открыть карты и, если не получилось, объяснить почему. */
async function navigate(query: string): Promise<void> {
  const ok = await openAddressInNavigator(query);
  if (!ok) {
    Alert.alert(
      "Не удалось открыть карты",
      "Похоже, на устройстве нет приложения с картами. Установите Яндекс Карты или Навигатор — кнопка заработает.",
    );
  }
}

export function CityPicker({
  visible,
  address,
  lastCity,
  onPick,
  onCancel,
}: CityPickerProps) {
  // Свой город, если его нет в списке (посёлок, другой населённый пункт)
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (visible) setCustom("");
  }, [visible]);

  // Город, выбранный в прошлый раз, — первым: чаще всего админ работает
  // в одном городе, и это экономит лишний взгляд.
  const cities = [...SERVICE_CITIES].sort((a, b) => {
    if (a === lastCity) return -1;
    if (b === lastCity) return 1;
    return 0;
  });

  const submitCustom = () => {
    const value = custom.trim();
    if (value) onPick(value);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        {/* Затемнение: тап мимо окна закрывает выбор */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />

        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>В каком городе адрес?</Text>
          <Text style={styles.address} numberOfLines={2}>
            📍 {address}
          </Text>
          <Text style={styles.hint}>
            Клиенты с сайта часто указывают только улицу. Выберите город —
            навигатор построит маршрут точно, а не в одноимённую улицу в другом
            городе.
          </Text>

          {cities.map((city) => (
            <Pressable
              key={city}
              style={({ pressed }) => [
                styles.cityRow,
                city === lastCity && styles.cityRowRecent,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => onPick(city)}
            >
              <Ionicons name="navigate" size={16} color={colors.primary} />
              <Text style={styles.cityName}>{city}</Text>
              {city === lastCity ? (
                <Text style={styles.cityRecent}>в прошлый раз</Text>
              ) : null}
            </Pressable>
          ))}

          <View style={styles.customRow}>
            <TextInput
              style={styles.customInput}
              value={custom}
              onChangeText={setCustom}
              placeholder="Другой город"
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={submitCustom}
              selectionColor={colors.primary}
            />
            <Pressable
              style={({ pressed }) => [
                styles.customButton,
                !custom.trim() && styles.customButtonDisabled,
                pressed && { opacity: 0.85 },
              ]}
              onPress={submitCustom}
              disabled={!custom.trim()}
            >
              <Text style={styles.customButtonText}>В путь</Text>
            </Pressable>
          </View>

          <Pressable
            style={({ pressed }) => [styles.noCity, pressed && { opacity: 0.85 }]}
            onPress={() => onPick(null)}
          >
            <Text style={styles.noCityText}>
              Без города — искать по {SERVICE_REGION}
            </Text>
          </Pressable>

          <Pressable style={styles.cancel} onPress={onCancel} hitSlop={8}>
            <Text style={styles.cancelText}>Отмена</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Кнопка «в навигатор» вместе с уточнением города.
 *
 * Использование:
 *   const { openRoute, picker } = useRouteCity();
 *   ... onPress={() => openRoute(lead)}
 *   ... {picker}
 *
 * Если город понятен из заявки — маршрут открывается сразу.
 */
export function useRouteCity() {
  const [pending, setPending] = useState<{
    address: string;
    lastCity: string | null;
  } | null>(null);

  const openRoute = useCallback(
    async (lead: { name: string; address: string; source?: string }) => {
      const address = lead.address.trim();
      if (!address) return;
      const city = leadCity(lead);
      if (city) {
        await navigate(queryWithCity(address, city));
        return;
      }
      setPending({ address, lastCity: await getLastRouteCity() });
    },
    [],
  );

  const pick = useCallback(
    async (city: string | null) => {
      const route = pending;
      setPending(null);
      if (!route) return;
      if (city) {
        await rememberRouteCity(city);
        await navigate(queryWithCity(route.address, city));
        return;
      }
      await navigate(queryWithoutCity(route.address));
    },
    [pending],
  );

  const picker = (
    <CityPicker
      visible={pending !== null}
      address={pending?.address ?? ""}
      lastCity={pending?.lastCity ?? null}
      onPick={pick}
      onCancel={() => setPending(null)}
    />
  );

  return { openRoute, picker };
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 22,
    gap: 10,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cardBorder,
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  address: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
  },
  cityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  cityRowRecent: {
    borderColor: "rgba(245,162,11,0.5)",
    backgroundColor: "rgba(245,162,11,0.1)",
  },
  cityName: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  cityRecent: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  customRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  customInput: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.inputBg,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
  },
  customButton: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  customButtonDisabled: {
    opacity: 0.45,
  },
  customButtonText: {
    color: colors.primaryForeground,
    fontSize: 15,
    fontWeight: "800",
  },
  noCity: {
    alignItems: "center",
    paddingVertical: 10,
  },
  noCityText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  cancel: {
    alignItems: "center",
    paddingVertical: 6,
  },
  cancelText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
});
