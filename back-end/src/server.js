const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const app = express();
const PORTA = 3000;
// Caminhos das pastas do projeto
const caminhoFrontend = path.join(
  __dirname,
  "..",
  "..",
  "front-end"
);
const caminhoBanco = path.join(
  __dirname,
  "..",
  "database",
  "ecoar.db"
);
app.use(express.json());
// Disponibiliza os arquivos do front-end
app.use(express.static(caminhoFrontend));
// Abre o banco de dados
const banco = new sqlite3.Database(caminhoBanco, (erro) => {
  if (erro) {
    console.error(
      "Erro ao abrir o banco de dados:",
      erro.message
    );
  } else {
    console.log("Banco de dados do ECOAR conectado.");
  }
});
// Cria a tabela caso ela ainda não exista
banco.run(`
  CREATE TABLE IF NOT EXISTS medicoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    temperatura REAL NOT NULL,
    umidade REAL NOT NULL,
    resistencia_gases REAL NOT NULL,
    iaq INTEGER NOT NULL,
    classificacao TEXT NOT NULL,
    data_hora TEXT NOT NULL
  )
`);
function limitar(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo);
}
/*
  IAQ experimental do ECOAR.

  O valor considera:
  - umidade relativa;
  - resistência de gases;
  - valor de referência calibrado em 48,6 kΩ.

  Quanto menor o resultado, melhor a condição estimada.

  Este resultado não corresponde ao índice oficial
  produzido pela biblioteca Bosch BSEC.
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
function classificarAmbiente(
  temperatura,
  umidade,
  iaq
) {
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
app.post("/api/medicoes", (req, res) => {
  const temperatura = Number(
    req.body.temperature
  );
  const umidade = Number(
    req.body.humidity
  );
  const resistenciaGases = Number(
    req.body.gas
  );
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
      erro:
        "A medição recebida possui valores inválidos."
    });
  }
  const iaq = calcularIAQ(
    umidade,
    resistenciaGases
  );
  const classificacao = classificarAmbiente(
    temperatura,
    umidade,
    iaq
  );
  const dataHora = new Date().toISOString();
  const comando = `
    INSERT INTO medicoes (
      temperatura,
      umidade,
      resistencia_gases,
      iaq,
      classificacao,
      data_hora
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  banco.run(
    comando,
    [
      temperatura,
      umidade,
      resistenciaGases,
      iaq,
      classificacao,
      dataHora
    ],
    function (erro) {
      if (erro) {
        return res.status(500).json({
          erro:
            "Não foi possível salvar a medição."
        });
      }
      res.status(201).json({
        id: this.lastID,
        timestamp: dataHora,
        temperature: temperatura,
        humidity: umidade,
        gas: resistenciaGases,
        iaq,
        classification: classificacao
      });
    }
  );
});
// Retorna a medição mais recente
app.get("/api/medicoes/atual", (req, res) => {
  const comando = `
    SELECT *
    FROM medicoes
    ORDER BY data_hora DESC
    LIMIT 1
  `;
  banco.get(
    comando,
    [],
    (erro, medicao) => {
      if (erro) {
        return res.status(500).json({
          erro:
            "Não foi possível consultar a medição."
        });
      }
      if (!medicao) {
        return res.status(404).json({
          erro:
            "Nenhuma medição foi registrada."
        });
      }
      res.json({
        id: medicao.id,
        timestamp: medicao.data_hora,
        temperature: medicao.temperatura,
        humidity: medicao.umidade,
        gas: medicao.resistencia_gases,
        iaq: medicao.iaq,
        classification:
          medicao.classificacao
      });
    }
  );
});
// Retorna o histórico de medições
app.get("/api/medicoes", (req, res) => {
  const comando = `
    SELECT *
    FROM medicoes
    ORDER BY data_hora ASC
    LIMIT 5000
  `;
  banco.all(
    comando,
    [],
    (erro, medicoes) => {
      if (erro) {
        return res.status(500).json({
          erro:
            "Não foi possível consultar o histórico."
        });
      }
      const resultado = medicoes.map(
        (medicao) => ({
          id: medicao.id,
          timestamp: medicao.data_hora,
          temperature: medicao.temperatura,
          humidity: medicao.umidade,
          gas: medicao.resistencia_gases,
          iaq: medicao.iaq,
          classification:
            medicao.classificacao
        })
      );
      res.json({
        total: resultado.length,
        readings: resultado
      });
    }
  );
});
// Verifica se a API está funcionando
app.get("/api/saude", (req, res) => {
  res.json({
    status: "ok",
    sistema: "ECOAR",
    dataHora: new Date().toISOString()
  });
});
// Inicia o servidor
app.listen(PORTA, "0.0.0.0", () => {
  console.log("------------------------------------");
  console.log("Servidor do ECOAR iniciado.");
  console.log(
    `Abra no navegador: http://localhost:${PORTA}`
  );
  console.log("------------------------------------");
});