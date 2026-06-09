# Leitor de Partituras - Bloco de Carnaval

Aplicativo local em React + TypeScript para organizar repertorio, abrir partituras, visualizar pistos de trompete e usar modo leitura com BPM, loop, cursor e destaque da nota atual.

## Funcionalidades

- Catalogo local de musicas com busca.
- Grupos/setlists salvos no navegador.
- Visualizacao de MusicXML com OpenSheetMusicDisplay.
- Modo leitura com zoom, BPM, loop e metrônomo.
- Destaque verde da nota atual na partitura.
- Indicador visual dos 3 pistos do trompete.
- Base JSON de notas, duracoes, compassos e fingerings.

## Rodar localmente

```bash
npm install
npm run dev
```

Depois abra:

```text
http://127.0.0.1:5174/
```

## Build

```bash
npm run build
```

## Observacao sobre assets

Os arquivos em `public/audio`, `public/scores` e `public/fingerings` sao usados pelo app local. Antes de publicar o repositorio como publico, confira se voce tem direito de distribuir audios, partituras e PDFs.
