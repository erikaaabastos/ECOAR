#include <Wire.h>
#include <WiFi.h>
#include "secrets.h"
#include <HTTPClient.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME680.h>

Adafruit_BME680 bme;

const char* ssid = WIFI_SSID;
const char* senha = WIFI_PASSWORD;

// Endereço da API no seu computador
const char* enderecoAPI =
  "http://192.168.15.9:3000/api/medicoes";

void conectarWifi() {
  Serial.print("Conectando ao Wi-Fi");

  WiFi.begin(nomeWifi, senhaWifi);

  int tentativas = 0;

  while (
    WiFi.status() != WL_CONNECTED &&
    tentativas < 30
  ) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi conectado!");

    Serial.print("IP do ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println(
      "Não foi possível conectar ao Wi-Fi."
    );
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Comunicação I2C:
  // SDA = pino 21
  // SCL = pino 22
  Wire.begin(21, 22);

  Serial.println("Iniciando o ECOAR...");

  // Tenta localizar o BME680 nos dois
  // endereços I2C possíveis
  if (!bme.begin(0x76, &Wire)) {
    if (!bme.begin(0x77, &Wire)) {
      Serial.println(
        "ERRO: sensor BME680 não encontrado."
      );

      Serial.println(
        "Verifique VCC, GND, SDA e SCL."
      );

      while (true) {
        delay(1000);
      }
    }
  }

  bme.setTemperatureOversampling(
    BME680_OS_8X
  );

  bme.setHumidityOversampling(
    BME680_OS_2X
  );

  bme.setIIRFilterSize(
    BME680_FILTER_SIZE_3
  );

  bme.setGasHeater(320, 150);

  Serial.println(
    "Sensor BME680 encontrado!"
  );

  conectarWifi();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(
      "Wi-Fi desconectado. Tentando reconectar..."
    );

    conectarWifi();
  }

  if (!bme.performReading()) {
    Serial.println(
      "Falha ao realizar a leitura."
    );

    delay(2000);
    return;
  }

  float temperatura = bme.temperature;
  float umidade = bme.humidity;

  float resistenciaGases =
    bme.gas_resistance / 1000.0;

  Serial.println("------------------------------");

  Serial.print("Temperatura: ");
  Serial.print(temperatura, 2);
  Serial.println(" °C");

  Serial.print("Umidade: ");
  Serial.print(umidade, 2);
  Serial.println(" %");

  Serial.print("Resistência de gases: ");
  Serial.print(resistenciaGases, 2);
  Serial.println(" kOhm");

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;

    http.begin(enderecoAPI);

    http.addHeader(
      "Content-Type",
      "application/json"
    );

    String dados = "{";

    dados += "\"temperature\":";
    dados += String(temperatura, 2);
    dados += ",";

    dados += "\"humidity\":";
    dados += String(umidade, 2);
    dados += ",";

    dados += "\"gas\":";
    dados += String(resistenciaGases, 2);

    dados += "}";

    Serial.print("Enviando para a API: ");
    Serial.println(dados);

    int codigoResposta = http.POST(dados);

    if (codigoResposta > 0) {
      Serial.print(
        "Código de resposta da API: "
      );

      Serial.println(codigoResposta);

      String resposta = http.getString();

      Serial.print("Resposta: ");
      Serial.println(resposta);
    } else {
      Serial.print(
        "Erro ao enviar a medição: "
      );

      Serial.println(
        http.errorToString(codigoResposta)
      );
    }

    http.end();
  }

  // Nova medição a cada 10 segundos
  delay(10000);
}