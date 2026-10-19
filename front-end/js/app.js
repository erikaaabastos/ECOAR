"use strict";

(() => {
  const $ = (id) => document.getElementById(id);

  const labels = {
    normal: "Normal",
    attention: "Atenção",
    discomfort: "Desconfortável",
    critical: "Crítico"
  };

  const definitions = {
    temperature: {
      name: "Temperatura",
      unit: "°C",
      hint: "Faixa de referência: 18 a 30 °C"
    },
    humidity: {
      name: "Umidade",
      unit: "%",
      hint: "Faixa de referência: 30 a 70%"
    },
    gas: {
      name: "Resistência de gases",
      unit: "kΩ",
      hint: "Resposta elétrica · não é concentração"
    },
    iaq: {
      name: "IAQ estimado",
      unit: "/ 500",
      hint: "Índice experimental · menor é melhor"
    }
  };

  let readings = [];
  let filtered = [];
  let page = 1;
  let paused = false;
  let busy = false;

  const pageSize = 10;

  function fmt(numero, casas = 1) {
    return Number(numero).toLocaleString("pt-BR", {
      minimumFractionDigits: casas,
      maximumFractionDigits: casas
    });
  }

  function formatarData(data) {
    return new Date(data).toLocaleString("pt-BR");
  }

  function badge(status) {
    let simbolo = "✓";

    if (status === "attention") {
      simbolo = "!";
    }

    if (status === "discomfort" || status === "critical") {
      simbolo = "⚠";
    }

    return `
      <span class="badge ${status}">
        ${simbolo} ${labels[status]}
      </span>
    `;
  }

  function anunciar(mensagem) {
    $("announcer").textContent = mensagem;
  }

  async function buscarAPI(endereco) {
    const resposta = await fetch(endereco, {
      headers: {
        Accept: "application/json"
      },
      cache: "no-store"
    });

    if (!resposta.ok) {
      const dadosErro = await resposta.json().catch(() => ({}));

      throw new Error(
        dadosErro.erro || "Não foi possível acessar a API."
      );
    }

    return resposta.json();
  }

  function statusTemperatura(valor) {
    if (valor < 10 || valor > 35) {
      return "critical";
    }

    if (valor < 16 || valor > 32) {
      return "discomfort";
    }

    if (valor < 18 || valor > 30) {
      return "attention";
    }

    return "normal";
  }

  function statusUmidade(valor) {
    if (valor < 20 || valor > 80) {
      return "critical";
    }

    if (valor < 25 || valor > 75) {
      return "discomfort";
    }

    if (valor < 30 || valor > 70) {
      return "attention";
    }

    return "normal";
  }

  function statusIAQ(valor) {
    if (valor > 200) {
      return "critical";
    }

    if (valor > 150) {
      return "discomfort";
    }

    if (valor > 100) {
      return "attention";
    }

    return "normal";
  }

  function mostrarSemLeituras() {
    $("last-reading").textContent = "Aguardando dados";
    $("environment-title").textContent = "Sem leituras";

    $("environment-description").textContent =
      "Ligue o ESP32 para iniciar o monitoramento.";

    $("hero-iaq").textContent = "—";

    $("metrics").innerHTML = Object.values(definitions)
      .map(
        (indicador) => `
          <article class="metric-card">
            <h3>${indicador.name}</h3>

            <p class="metric-value">
              — <span>${indicador.unit}</span>
            </p>

            <span class="badge neutral">Aguardando</span>

            <p>${indicador.hint}</p>
          </article>
        `
      )
      .join("");

    $("alerts").innerHTML =
      "<p>Nenhuma leitura foi recebida pelo sistema.</p>";
  }

  function atualizarLeituraAtual() {
    const leitura = readings.at(-1);

    if (!leitura) {
      mostrarSemLeituras();
      return;
    }

    const status = leitura.classification;

    $("last-reading").textContent =
      formatarData(leitura.timestamp);

    $("last-reading").dateTime = leitura.timestamp;

    let simbolo = "✓ ";

    if (status === "attention") {
      simbolo = "! ";
    }

    if (status === "discomfort" || status === "critical") {
      simbolo = "⚠ ";
    }

    $("environment-title").textContent =
      simbolo + labels[status];

    const descricoes = {
      normal:
        "Indicadores dentro das faixas de referência do projeto.",

      attention:
        "Um ou mais indicadores exigem atenção.",

      discomfort:
        "As condições indicam possível desconforto ambiental.",

      critical:
        "Há indicadores na faixa crítica do projeto."
    };

    $("environment-description").textContent =
      descricoes[status];

    $("hero-iaq").textContent = leitura.iaq;

    const valores = {
      temperature: leitura.temperature,
      humidity: leitura.humidity,
      gas: leitura.gas,
      iaq: leitura.iaq
    };

    $("metrics").innerHTML = Object.entries(definitions)
      .map(([chave, indicador]) => {
        let statusIndicador = null;

        if (chave === "temperature") {
          statusIndicador =
            statusTemperatura(leitura.temperature);
        }

        if (chave === "humidity") {
          statusIndicador =
            statusUmidade(leitura.humidity);
        }

        if (chave === "iaq") {
          statusIndicador = statusIAQ(leitura.iaq);
        }

        let identificacao = `
          <span class="badge neutral">
            Leitura do sensor
          </span>
        `;

        if (statusIndicador) {
          identificacao = badge(statusIndicador);
        }

        return `
          <article class="metric-card">
            <h3>${indicador.name}</h3>

            <p class="metric-value">
              ${fmt(
                valores[chave],
                chave === "iaq" ? 0 : 1
              )}
              <span>${indicador.unit}</span>
            </p>

            ${identificacao}

            <p>${indicador.hint}</p>
          </article>
        `;
      })
      .join("");

    atualizarAlertas(leitura);
  }

  function atualizarAlertas(leitura) {
    const alertas = [];

    const temperatura =
      statusTemperatura(leitura.temperature);

    const umidade =
      statusUmidade(leitura.humidity);

    const iaq =
      statusIAQ(leitura.iaq);

    if (
      temperatura === "discomfort" ||
      temperatura === "critical"
    ) {
      alertas.push(
        `Temperatura fora da faixa: ${fmt(
          leitura.temperature
        )} °C.`
      );
    }

    if (
      umidade === "discomfort" ||
      umidade === "critical"
    ) {
      alertas.push(
        `Umidade fora da faixa: ${fmt(
          leitura.humidity
        )}%.`
      );
    }

    if (
      iaq === "discomfort" ||
      iaq === "critical"
    ) {
      alertas.push(
        `IAQ estimado em nível ${labels[
          iaq
        ].toLowerCase()}: ${leitura.iaq}.`
      );
    }

    if (alertas.length === 0) {
      $("alerts").innerHTML = `
        <p>
          ✓ Nenhum alerta de desconforto ou nível crítico
          nesta leitura.
        </p>
      `;

      return;
    }

    $("alerts").innerHTML = alertas
      .map(
        (mensagem) => `
          <p>
            ${badge(leitura.classification)}
            ${mensagem}
          </p>
        `
      )
      .join("");
  }

  function aplicarFiltros(reiniciarPagina = true) {
    let inicio = 0;
    let fim = Date.now();
    let erro = "";

    const periodo = $("period").value;

    $("custom-dates").hidden =
      periodo !== "custom";

    if (periodo === "today") {
      const hoje = new Date();

      hoje.setHours(0, 0, 0, 0);

      inicio = hoje.getTime();
    } else if (periodo === "custom") {
      if (!$("start").value || !$("end").value) {
        erro =
          "Escolha a data inicial e a data final.";
      } else {
        inicio = new Date(
          `${$("start").value}T00:00:00`
        ).getTime();

        const dataFinal = new Date(
          `${$("end").value}T00:00:00`
        );

        dataFinal.setDate(dataFinal.getDate() + 1);

        fim = dataFinal.getTime() - 1;

        if (inicio > fim) {
          erro =
            "A data inicial deve ser anterior ou igual à data final.";
        }
      }
    } else {
      inicio =
        fim - Number(periodo) * 24 * 60 * 60 * 1000;
    }

    $("filter-error").textContent = erro;

    const classificacao =
      $("classification").value;

    filtered = erro
      ? []
      : readings.filter((leitura) => {
          const horario = new Date(
            leitura.timestamp
          ).getTime();

          const dentroDoPeriodo =
            horario >= inicio && horario <= fim;

          const classificacaoCorreta =
            classificacao === "all" ||
            leitura.classification === classificacao;

          return (
            dentroDoPeriodo &&
            classificacaoCorreta
          );
        });

    if (reiniciarPagina) {
      page = 1;
    }

    const totalPaginas = Math.max(
      1,
      Math.ceil(filtered.length / pageSize)
    );

    page = Math.min(page, totalPaginas);

    renderizarGrafico();
    renderizarTabela();
  }

  function renderizarGrafico() {
    const chave = $("metric").value;
    const indicador = definitions[chave];

    if (filtered.length === 0) {
      $("chart").innerHTML = `
        <p class="muted">
          Nenhuma leitura encontrada neste período.
        </p>
      `;

      $("chart-summary").textContent = "";

      return;
    }

    const valores = filtered.map(
      (leitura) => leitura[chave]
    );

    const minimo = Math.min(...valores);
    const maximo = Math.max(...valores);

    const media =
      valores.reduce(
        (total, valor) => total + valor,
        0
      ) / valores.length;

    const limiteInferior = Math.max(
      0,
      Math.floor(minimo - 3)
    );

    const limiteSuperior = Math.max(
      limiteInferior + 1,
      Math.ceil(maximo + 3)
    );

    const esquerda = 55;
    const direita = 895;
    const topo = 15;
    const base = 208;

    const primeiroHorario = new Date(
      filtered[0].timestamp
    ).getTime();

    const ultimoHorario = new Date(
      filtered.at(-1).timestamp
    ).getTime();

    function posicaoX(leitura) {
      if (primeiroHorario === ultimoHorario) {
        return (esquerda + direita) / 2;
      }

      const horario = new Date(
        leitura.timestamp
      ).getTime();

      return (
        esquerda +
        ((horario - primeiroHorario) /
          (ultimoHorario - primeiroHorario)) *
          (direita - esquerda)
      );
    }

    function posicaoY(valor) {
      return (
        base -
        ((valor - limiteInferior) /
          (limiteSuperior - limiteInferior)) *
          (base - topo)
      );
    }

    const pontos = filtered
      .map(
        (leitura) =>
          `${posicaoX(leitura).toFixed(
            2
          )},${posicaoY(leitura[chave]).toFixed(2)}`
      )
      .join(" ");

    let linhas = "";

    for (let i = 0; i < 5; i++) {
      const valor =
        limiteInferior +
        ((limiteSuperior - limiteInferior) * i) / 4;

      linhas += `
        <line
          x1="${esquerda}"
          x2="${direita}"
          y1="${posicaoY(valor)}"
          y2="${posicaoY(valor)}"
          stroke="#e2e9e2"
        />

        <text
          x="44"
          y="${posicaoY(valor) + 4}"
          text-anchor="end"
        >
          ${fmt(valor, 0)}
        </text>
      `;
    }

    function rotuloHorario(horario) {
      if ($("period").value === "today") {
        return new Date(horario).toLocaleTimeString(
          "pt-BR",
          {
            hour: "2-digit",
            minute: "2-digit"
          }
        );
      }

      return new Date(horario).toLocaleDateString(
        "pt-BR",
        {
          day: "2-digit",
          month: "2-digit"
        }
      );
    }

    $("chart").innerHTML = `
      <svg
        viewBox="0 0 920 250"
        role="img"
        aria-labelledby="svg-title svg-desc"
      >
        <title id="svg-title">
          Evolução de ${indicador.name}
        </title>

        <desc id="svg-desc">
          ${filtered.length} leituras.
          Valor mínimo ${fmt(minimo)},
          valor máximo ${fmt(maximo)}
          ${indicador.unit}.
        </desc>

        ${linhas}

        <polyline
          points="${pontos}"
          fill="none"
          stroke="#22714f"
          stroke-width="3"
          stroke-linejoin="round"
        />

        ${
          filtered.length === 1
            ? `
              <circle
                cx="${posicaoX(filtered[0])}"
                cy="${posicaoY(valores[0])}"
                r="5"
                fill="#22714f"
              />
            `
            : ""
        }

        <text
          x="${esquerda}"
          y="238"
        >
          ${rotuloHorario(primeiroHorario)}
        </text>

        <text
          x="${direita}"
          y="238"
          text-anchor="end"
        >
          ${rotuloHorario(ultimoHorario)}
        </text>
      </svg>
    `;

    $("chart-summary").textContent =
      `${indicador.name} (${indicador.unit}) · ` +
      `Mínima: ${fmt(minimo)} · ` +
      `Média: ${fmt(media)} · ` +
      `Máxima: ${fmt(maximo)} · ` +
      `${filtered.length} leituras.`;
  }

  function renderizarTabela() {
    const ordenadas = filtered
      .slice()
      .reverse();

    const inicio = (page - 1) * pageSize;
    const fim = page * pageSize;

    const paginaAtual =
      ordenadas.slice(inicio, fim);

    $("count").textContent =
      `${filtered.length} leituras`;

    if (paginaAtual.length === 0) {
      $("rows").innerHTML = `
        <tr>
          <td colspan="6">
            Nenhuma leitura encontrada.
          </td>
        </tr>
      `;
    } else {
      $("rows").innerHTML = paginaAtual
        .map(
          (leitura) => `
            <tr>
              <td>
                ${formatarData(leitura.timestamp)}
              </td>

              <td>
                ${fmt(leitura.temperature)} °C
              </td>

              <td>
                ${fmt(leitura.humidity)} %
              </td>

              <td>
                ${fmt(leitura.gas)} kΩ
              </td>

              <td>
                ${leitura.iaq}
              </td>

              <td>
                ${badge(leitura.classification)}
              </td>
            </tr>
          `
        )
        .join("");
    }

    const totalPaginas = Math.ceil(
      filtered.length / pageSize
    );

    $("page-info").textContent =
      filtered.length > 0
        ? `Página ${page} de ${totalPaginas}`
        : "0 leituras";

    $("prev").disabled = page <= 1;

    $("next").disabled =
      page * pageSize >= filtered.length;
  }

  async function atualizarDados(atualizacaoManual = false) {
    if (busy || paused) {
      return;
    }

    busy = true;

    $("refresh").disabled = true;
    $("refresh").textContent = "Atualizando…";

    try {
      const dados = await buscarAPI(
        "/api/medicoes"
      );

      readings = dados.readings;

      atualizarLeituraAtual();
      aplicarFiltros(false);

      if (readings.length > 0) {
        $("connection").textContent =
          "API conectada · atualização a cada 10 s";
      } else {
        $("connection").textContent =
          "API conectada · aguardando ESP32";
      }

      if (atualizacaoManual) {
        anunciar(
          readings.length > 0
            ? `Leituras atualizadas. Classificação atual: ${
                labels[
                  readings.at(-1).classification
                ]
              }.`
            : "Ainda não existem leituras."
        );
      }
    } catch (erro) {
      $("connection").textContent =
        "Sem conexão com a API";

      anunciar(erro.message);
    } finally {
      busy = false;

      $("refresh").disabled = false;
      $("refresh").textContent =
        "↻ Atualizar leitura";
    }
  }

  $("refresh").addEventListener("click", () => {
    atualizarDados(true);
  });

  $("pause").addEventListener("click", () => {
    paused = !paused;

    $("pause").setAttribute(
      "aria-pressed",
      String(paused)
    );

    $("pause").textContent = paused
      ? "Retomar atualização"
      : "Pausar atualização";

    $("connection").textContent = paused
      ? "Atualização pausada · última leitura preservada"
      : "Atualização automática ativa";

    anunciar(
      paused
        ? "Atualização pausada."
        : "Atualização retomada."
    );

    if (!paused) {
      atualizarDados();
    }
  });

  $("filters").addEventListener(
    "submit",
    (evento) => {
      evento.preventDefault();
    }
  );

  $("filters").addEventListener(
    "change",
    () => {
      aplicarFiltros();

      anunciar(
        `${filtered.length} leituras encontradas.`
      );
    }
  );

  $("filters").addEventListener(
    "reset",
    () => {
      setTimeout(() => {
        aplicarFiltros();
        anunciar("Filtros limpos.");
      }, 0);
    }
  );

  $("metric").addEventListener(
    "change",
    renderizarGrafico
  );

  $("prev").addEventListener("click", () => {
    page -= 1;
    renderizarTabela();
  });

  $("next").addEventListener("click", () => {
    page += 1;
    renderizarTabela();
  });

  function atualizarNavegacao() {
    document
      .querySelectorAll("nav a")
      .forEach((link) => {
        if (
          link.hash ===
          (location.hash || "#painel")
        ) {
          link.setAttribute(
            "aria-current",
            "page"
          );
        } else {
          link.removeAttribute(
            "aria-current"
          );
        }
      });
  }

  window.addEventListener(
    "hashchange",
    atualizarNavegacao
  );

  atualizarNavegacao();
  mostrarSemLeituras();
  aplicarFiltros();
  atualizarDados();

  setInterval(() => {
    if (!paused && !document.hidden) {
      atualizarDados();
    }
  }, 10000);
})();