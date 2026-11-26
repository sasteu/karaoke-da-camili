# Karaokê da Camili

Karaokê web para usar em casa, com tema rosa, lilás e ameixa. O computador reproduz a música e captura o microfone; o celular, na mesma rede Wi-Fi, pode escolher músicas e entrar na fila.

## Recursos

- Biblioteca de músicas em formato UltraStar, instrumental e voz original.
- Letras sincronizadas e barra de notas com acompanhamento da voz.
- Pontuação casual de 0 a 10.000 com tolerância de afinação e oitavas.
- Resultado ao terminar a música e recorde por música com o nome do cantor.
- Busca no YouTube e importação com separação de áudio e geração de notas pelo processador externo.
- Consulta gratuita ao LRCLIB e revisão da letra comparada à transcrição antes da sincronização.
- Fila, histórico, exclusão reversível e lixeira.

## Executar no Windows

Requer Node.js 24 ou superior. Não há dependências npm.

```powershell
cd web-karaoke
npm start
```

Abra http://localhost:8787. O atalho `Abrir-Karaoke-Web.cmd` inicia o servidor em segundo plano e abre o navegador. `Fechar-Karaoke-Web.cmd` encerra o servidor. Não reinicie durante uma importação.

Na primeira clonagem, a biblioteca começa vazia. Músicas, modelos e executáveis são dependências locais e não acompanham este repositório.

## Preparar músicas e processamento

O projeto usa o [Ultrastar Creator Tool 5.0.0](https://github.com/retotito/UltrastarCreatorTool) como processador externo. Baixe a versão Windows na página oficial de releases e prepare os modelos pelo próprio aplicativo. A instalação local original foi extraída do MSI para a estrutura abaixo:

```text
runtime/PFiles/UltrastarCreatorTool/
  ultrastar-creator.exe
  resources/backend/backend.exe
  resources/backend/_internal/ffmpeg.exe
dados/       # modelos, sessões e preferências locais
musicas/     # pastas com .txt UltraStar e arquivos de áudio
```

Os scripts `Abrir-Criador.cmd` e `Iniciar-Criador.ps1` esperam essa estrutura. O backend usa a porta 8001. Outra instância compatível pode ser indicada por `KARAOKE_BACKEND_URL`, restrita a localhost. A captura nativa de microfone requer o FFmpeg no caminho mostrado acima e usa DirectShow no Windows. O servidor inicia mesmo sem o processador, mas importação e captura dependem desses componentes.

Use somente músicas e arquivos que você tem autorização para utilizar. O código do processador permanece no repositório de origem; não é redistribuído aqui.

## Desenvolvimento

```powershell
cd web-karaoke
npm test
```

Os testes criam bibliotecas e processadores simulados em pastas temporárias. `KARAOKE_PORT`, `KARAOKE_DATA_DIR` e `KARAOKE_SONGS_DIR` permitem configurar porta, dados e biblioteca. O app foi pensado para rede doméstica confiável, sem autenticação ou publicação na internet.

Detalhes de funcionamento estão em [web-karaoke/README.md](web-karaoke/README.md). Dados de cantores, histórico, recordes e músicas permanecem locais, em pastas ignoradas pelo Git.
