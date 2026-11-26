# Karaokê da Camili

O karaokê roda em http://localhost:8787. Execute `Abrir-Karaoke-Web.cmd` na pasta principal. Biblioteca e modelos existentes são preservados. Não há publicação na internet.

## Uso

Escolha **Cantar** em uma música e ative o microfone antes de reproduzir para pontuar desde o início. A pontuação vai de 0 a 10.000, aceita oitavas diferentes e não dá pontos ao silêncio. **Instrumental** e **Com voz original** preservam a posição. A sincronia da letra pode ser ajustada manualmente.

Importação por link, busca no YouTube, fila e histórico continuam disponíveis. Em **Usar celular**, abra o endereço de rede no celular conectado ao mesmo Wi-Fi para escolher músicas e entrar na fila. Reprodução e microfone ficam no computador.

## Microfone nativo local

Em 26/11/2026, os testes do usuário mostraram que abrir getUserMedia no Chrome e Edge silenciava a música, inclusive sem AudioContext. A gravação no Gravador de Som do Windows mantinha a música normal. O player principal passou a usar uma captura nativa pelo FFmpeg já instalado no projeto, evitando abrir o microfone pelo navegador.

- `native-microphone.mjs` abre a entrada DirectShow escolhida, recebe PCM mono a 16 kHz e calcula afinação e nível de entrada na memória do processo local.
- O navegador recebe somente `{hz, level, at}` por SSE. Não recebe nem envia gravação de voz. Não é criado arquivo de áudio.
- **Ativar microfone** é uma ação explícita do usuário. Desativar encerra o processo de captura. Perda de heartbeat encerra a captura após aproximadamente 12 segundos; troca de dono da sala e liberação do player também encerram a captura.
- Os endpoints `/api/microphone/*` são restritos ao próprio computador, pelo host localhost/loopback. O celular não pode ligar ou acompanhar o microfone nativo. Os controles de captura exigem o dono da sala.
- O som continua no elemento HTMLAudio nativo. O motor de captura não toca na reprodução. A saída fica no padrão do computador.

Feche páginas antigas de diagnóstico no Chrome/Edge antes de testar esta versão. Elas podem continuar usando a captura antiga do navegador. Atualize a página principal com Ctrl + F5 e confirme a indicação **captura nativa local** nos ajustes de áudio.

## Validação e limites

`npm test` executa testes de notas/pontuação, captura, PCM fragmentado, propriedade do microfone, cancelamento, encerramento automático e integração HTTP. O teste de servidor usa a porta 18787.

A captura real foi verificada por três segundos, com 46 blocos recebidos. A integração na interface funcionou durante 26 segundos junto com a reprodução, exibindo nível e afinação sem erros de console; o microfone foi desligado ao final. Depois da troca para captura nativa, o usuário confirmou que o som funcionou.

A preferência de comunicações do Windows e as melhorias dos alto-falantes testadas anteriormente não resolveram e foram restauradas. Esta versão não modifica configurações de som do Windows.

## Desenvolvimento e cópias anteriores

Sem dependências npm. `npm start` inicia o servidor na porta 8787. Alterações no frontend só precisam de atualização da página; alterações no servidor exigem reinício. Não reinicie durante uma importação de música.

A versão anterior da interface está em `../dados/web-karaoke/backup-antes-reconstrucao-2026-11-26/`. Músicas ficam em `../musicas`; modelos e dados em `../dados`.

O diagnóstico antigo `/?audio-test=1` permanece separado e usa captura pelo navegador, somente para comparação. Ele não é o player principal e deve ser fechado após o teste.

## Barra de notas e pontuação

O antigo painel de notas musicais/agulha foi substituído pela barra de notas que passa da direita para a esquerda. O cursor marca o momento de cantar; o traço claro mostra a voz, com aceitação de oitavas diferentes. As notas passadas ficam rosas nos acertos e amarelas nos acertos parciais. O desenho usa o mesmo tempo de referência da pontuação.

A pontuação usa uma regra casual: diferença até 0,75 semitom recebe crédito integral; de 0,75 até 2 semitons recebe crédito parcial decrescente; a partir de 2, zero. Nas transições há margem de 120 ms para mudar entre notas vizinhas. A margem não cria tempo extra de pontuação e não pontua silêncios ou partes livres.

Ligar o microfone durante a música passa a pontuar imediatamente a partir desse trecho. Foi removido o bloqueio que exigia recomeçar a música. Desligar o microfone depois de cantar não apaga os pontos já obtidos do resultado final.

A sincronia de cada música fica salva no localStorage deste navegador, com limite de ±10 segundos e passos de 0,1 s. O botão do valor zera o ajuste. Mudar a sincronia ou o atraso da entrada reinicia a pontuação do trecho. O denominador usa o mesmo intervalo de referência das notas. O preenchimento gradual das sílabas e a contagem para entrar na voz permanecem.

Verificação: testes cobrem crédito integral com pequena imprecisão, crédito parcial, oitavas, margem de transição sem criar pontos em pausas e cálculo iniciado no meio de uma música usando frequência detectada em amostras a 16 kHz. A barra foi conferida no navegador, com notas no ponto selecionado, sem erros de console. A captura nativa não foi alterada.

## Controles de reprodução

A linha de progresso é somente visual, sem clique, arraste ou controle por teclado. O botão de reiniciar foi removido, assim como a repetição pelo botão de play ao terminar a música. Permanecem reproduzir/pausar, volume e próxima da fila. Selecionar uma música na biblioteca inicia uma nova apresentação. Ao mudar de frase, as cores de todas as frases fora de foco são limpas, evitando sílabas verdes em frases futuras após ajustes de tempo.

## Adicionar músicas e comparar letras

A entrada reconhece links de vídeos do YouTube, links de resultados do Google que apontam para o YouTube e links de pesquisa do Google contendo `q`. Uma pesquisa vira uma busca de vídeos para o usuário escolher a gravação; não é tratada como áudio. Links curtos genéricos de compartilhamento do Google e páginas de outros serviços não são resolvidos automaticamente.

**Identificar música** consulta os dados do vídeo. Quando possível, os nomes são conferidos no LRCLIB ou na biblioteca existente, inclusive quando o título do vídeo está na ordem música–artista. Se não houver correspondência única, o sistema informa que os campos precisam ser conferidos. Artista e música permanecem editáveis e há um botão para inverter os campos. A identificação pode falhar ou não distinguir covers e versões ao vivo; confirme antes de preparar.

A opção escolhida nesta instalação não usa chave nem API paga. A busca de referência é feita no LRCLIB. Os botões do Google abrem uma pesquisa comum para consulta manual e permitem colar outra letra na revisão; não coletam automaticamente a letra do Google.

O importador busca a referência antes de transcrever, mas agora transcreve mesmo quando encontrou a letra, para comparar as duas versões. A comparação usa distância entre palavras e ignora caixa, pontuação e acentos. Destaca palavras diferentes, trechos ausentes e repetições; a porcentagem é semelhança textual, não confiança sobre a letra correta.

Por padrão, **Comparar e revisar a letra antes de sincronizar** está marcado. Depois da busca e transcrição, o cartão da importação mostra **Comparar e revisar letra**. Nessa janela, pode-se colar outra referência, comparar novamente, escolher uma versão, editar a letra final e continuar a sincronização. Fechar a janela mantém a importação aguardando; o botão no cartão permite voltar. Uma importação aguardando revisão bloqueia a próxima até continuar ou cancelar. A opção pode ser desmarcada para seguir automaticamente com a referência informada/encontrada ou com a transcrição, se não houver referência.

Falha na busca não impede transcrever; falha na transcrição não descarta uma referência disponível. Ambas as situações ficam explícitas na revisão. As versões comparadas e a letra final são registradas localmente em `../dados/web-karaoke/revisoes-letras/`. Não há correção silenciosa por substituição de palavras.

Os testes de importação usam um processador HTTP simulado e pastas temporárias próprias, sem baixar música nem alterar a biblioteca real. As variáveis `KARAOKE_BACKEND_URL`, `KARAOKE_DATA_DIR` e `KARAOKE_SONGS_DIR` permitem esse isolamento. O processador permanece restrito a localhost.

## Excluir e restaurar músicas

O botão separado **Adicionar por link** foi removido; o campo principal de busca continua aceitando nomes e links. Em cada música há **Excluir**, com confirmação. A exclusão remove a música da biblioteca e da fila, incluindo cópias duplicadas da mesma versão. Uma música em reprodução precisa ser pausada antes.

A exclusão é reversível pela **Lixeira**, ao lado do filtro da biblioteca. Os arquivos de áudio e de notas permanecem no lugar; o índice de versões ocultas fica em `../dados/web-karaoke/lixeira-musicas.json`. A lixeira preserva o estado entre reinícios. Uma versão modificada/importada novamente é identificada pelo conteúdo das notas e pelos dados do arquivo de áudio, sem reapresentar automaticamente as cópias antigas ocultas. Restaurar não sobrescreve arquivos. O histórico dos shows é mantido.

A API anuncia suporte à lixeira na resposta da biblioteca; os botões não são mostrados em um servidor antigo que ainda aguarda reinício. As mudanças da biblioteca são propagadas aos outros navegadores por eventos locais.

Teste de integração: músicas fictícias duplicadas em pasta temporária, bloqueio de exclusão durante reprodução, remoção da fila, persistência após reinício, preservação dos arquivos, nova versão e restauração. Nenhuma música real foi excluída na verificação.

Revisões que já terminaram a transcrição e estão aguardando escolha da letra são preservadas em `../dados/web-karaoke/revisoes-pendentes.json`. Elas voltam a aguardar revisão após reiniciar o servidor, sem transcrever novamente. O teste de importação também verifica essa retomada. Ainda se deve evitar reiniciar durante download, separação, transcrição ou geração em andamento.

## Resultado e recordes

Ao terminar o áudio, a tela mostra a pontuação de 0 a 10.000, o cantor e o botão **Voltar à biblioteca**. O microfone é encerrado ao finalizar. Cada cartão mostra a maior pontuação e quem a fez; empates preservam o primeiro recordista. Preencha o nome do cantor antes da rodada.

Os recordes são salvos em `../dados/web-karaoke/recordes.json`, separados do limite de 100 resultados do histórico. Resultados completos disponíveis no histórico antigo são aproveitados. Pontuações de trechos iniciados após a primeira nota aparecem no resultado e no histórico, mas não disputam recorde.
