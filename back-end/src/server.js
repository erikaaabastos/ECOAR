require("dotenv").config();
const express = require("express");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const app = express();
const PORTA = process.env.PORT || process.env.PORTA || 3000;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseChave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseChave) {
  console.error("As credenciais do Supabase não foram configuradas.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseChave, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});
app.use(express.json());
function validarChaveESP32(req, res, next) {
  const chaveRecebida = req.get("x-api-key");
  const chaveCorreta = process.env.ESP32_API_KEY;

  if (!chaveCorreta || chaveRecebida !== chaveCorreta) {
    return res.status(401).json({
      erro: "Acesso não autorizado."
    });
  }

  next();
}
app.use(
  express.static(path.join(__dirname, "../../front-end"))
);
function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo);
}
/*
  IAQ experimental do ECOAR.

  O valor considera:
  - umidade relativa;
  - resistência de gases;
  - valor de referência de 48,6 kΩ.
  Quanto menor o resultado, melhor a condição estimada.
  Não corresponde ao índice oficial da biblioteca Bosch BSEC.
*/
function calcularIAQ(umidade, resistenciaGases) {
  const referenciaGases = 48.6;
  const pontuacaoUmidade = limitar(
    100 - Math.abs(umidade - 40) * 2.5,
    0,
    100
  );
  const pontuacaoGases = limitar(
    (resistenciaGases / referenciaGases) * 100,
    0,
    100
  );
  const qualidade =
    pontuacaoGases * 0.75 +
    pontuacaoUmidade * 0.25;

  return Math.round(
    limitar(500 - qualidade * 5, 0, 500)
  );
}
function classificarAmbiente(temperatura, umidade, iaq) {
  if (
    temperatura < 10 ||
    temperatura > 35 ||
    umidade < 20 ||
    umidade > 80 ||
    iaq > 200
  ) {
    return "critical";
  }
  if (
    temperatura < 16 ||
    temperatura > 32 ||
    umidade < 25 ||
    umidade > 75 ||
    iaq > 150
  ) {
    return "discomfort";
  }
  if (
    temperatura < 18 ||
    temperatura > 30 ||
    umidade < 30 ||
    umidade > 70 ||
    iaq > 100
  ) {
    return "attention";
  }
  return "normal";
}
// Recebe as medições enviadas pelo ESP32
app.post(
  "/api/medicoes",
  validarChaveESP32,
  async (req, res) => {
  try {
    const temperatura = Number(req.body.temperature);
    const umidade = Number(req.body.humidity);
    const resistenciaGases = Number(req.body.gas);
    if (
      !Number.isFinite(temperatura) ||
      !Number.isFinite(umidade) ||
      !Number.isFinite(resistenciaGases)
    ) {
      return res.status(400).json({
        erro:
          "Temperatura, umidade e resistência de gases são obrigatórias."
      });
    }
    if (
      temperatura < -40 ||
      temperatura > 85 ||
      umidade < 0 ||
      umidade > 100 ||
      resistenciaGases <= 0
    ) {
      return res.status(400).json({
        erro: "A medição recebida possui valores inválidos."
      });
    }
    const iaq = calcularIAQ(umidade, resistenciaGases);
    const classificacao = classificarAmbiente(
      temperatura,
      umidade,
      iaq
    );
    const dataHora = new Date().toISOString();
    const { data, error } = await supabase
      .from("medicoes")
      .insert({
        temperatura,
        umidade,
        resistencia_gases: resistenciaGases,
        iaq,
        classificacao,
        data_hora: dataHora
      })
      .select()
      .single();
    if (error) {
      console.error("Erro ao salvar medição:", error.message);

      return res.status(500).json({
        erro: "Não foi possível salvar a medição."
      });
    }
    return res.status(201).json({
      id: data.id,
      timestamp: data.data_hora,
      temperature: data.temperatura,
      humidity: data.umidade,
      gas: data.resistencia_gases,
      iaq: data.iaq,
      classification: data.classificacao
    });
  } catch (erro) {
    console.error("Erro inesperado:", erro);
    return res.status(500).json({
      erro: "Ocorreu um erro interno no servidor."
    });
  }
  }
);
// Retorna a medição mais recente
app.get("/api/medicoes/atual", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("medicoes")
      .select("*")
      .order("data_hora", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Erro ao consultar medição:", error.message);

      return res.status(500).json({
        erro: "Não foi possível consultar a medição."
      });
    }
    if (!data) {
      return res.status(404).json({
        erro: "Nenhuma medição foi registrada."
      });
    }
    return res.json({
      id: data.id,
      timestamp: data.data_hora,
      temperature: data.temperatura,
      humidity: data.umidade,
      gas: data.resistencia_gases,
      iaq: data.iaq,
      classification: data.classificacao
    });
  } catch (erro) {
    console.error("Erro inesperado:", erro);
    return res.status(500).json({
      erro: "Ocorreu um erro interno no servidor."
    });
  }
});
// Retorna o histórico de medições
app.get("/api/medicoes", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("medicoes")
      .select("*")
      .order("data_hora", { ascending: true })
      .limit(5000);

    if (error) {
      console.error("Erro ao consultar histórico:", error.message);

      return res.status(500).json({
        erro: "Não foi possível consultar o histórico."
      });
    }
    const resultado = (data || []).map((medicao) => ({
      id: medicao.id,
      timestamp: medicao.data_hora,
      temperature: medicao.temperatura,
      humidity: medicao.umidade,
      gas: medicao.resistencia_gases,
      iaq: medicao.iaq,
      classification: medicao.classificacao
    }));
    return res.json({
      total: resultado.length,
      readings: resultado
    });
  } catch (erro) {
    console.error("Erro inesperado:", erro);
    return res.status(500).json({
      erro: "Ocorreu um erro interno no servidor."
    });
  }
});
// Verifica se a API está funcionando
app.get("/api/saude", (req, res) => {
  res.json({
    status: "ok",
    sistema: "ECOAR",
    bancoDeDados: "Supabase",
    dataHora: new Date().toISOString()
  });
});
app.listen(PORTA, "0.0.0.0", () => {
  console.log("------------------------------------");
  console.log("Servidor do ECOAR iniciado.");
  console.log(`Abra no navegador: http://localhost:${PORTA}`);
  console.log("Banco de dados: Supabase");
  console.log("------------------------------------");
});