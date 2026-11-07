# Safra — organizador de colheita

Aplicativo local para registrar serviços, estufadas, equipe, pagamentos, trocas de dia e empréstimos do trator.

## Abrir o app

No Windows, abra `Iniciar Safra.bat`. Ele inicia o servidor local e abre `http://localhost:8765`. Deixe a janela do servidor aberta enquanto usa o app. Feche com `Ctrl+C` ao terminar.

O app funciona sem internet. Para o arquivo local salvar automaticamente, use o endereço aberto pelo iniciador; abrir `index.html` diretamente usa só o armazenamento do navegador.

## Armazenamento

Cada alteração é gravada automaticamente em `%LOCALAPPDATA%\Safra\records.json`, fora da pasta do projeto. Antes de substituir o arquivo, o servidor guarda uma cópia da versão anterior em `%LOCALAPPDATA%\Safra\backups` e mantém as dez versões mais recentes. IndexedDB e localStorage também servem como cópias locais auxiliares. A tela de backup continua disponível para exportar uma cópia externa quando você quiser.

O arquivo fica neste computador; o endereço local não sincroniza registros com celular ou outros aparelhos. Para uso diário não é preciso importar nem exportar o backup.

## Regras dos registros

- Dias de trabalho e frações de estufada são somados separadamente. Meio dia vale 0,5 dia; estufadas concluídas podem ser lançadas como frações, como 0,8 e 0,2.
- O calendário pessoal mostra serviços para terceiros quando Eros está na equipe. Uma equipe antiga vazia é tratada como registro pessoal e, ao editar, Eros aparece marcado para confirmar.
- Uma estufada da família aparece em “Nossa colheita”; ela também aparece no calendário pessoal quando Eros está na equipe.
- Serviços ligados a uma estufada da família não entram na contagem de estufadas dos patrões.
- Na troca, os dias registrados para uma pessoa viram crédito para receber de volta. Quando Pablo aparece na equipe de uma estufada da família, os dias trabalhados por ele reduzem automaticamente esse crédito.
- Na produção da família, Eros, Ivonei/Pai e Silvani não geram pagamento. Pablo usa troca de dia; os outros camaradas começam como pagamento em dinheiro e podem ser marcados como pagos.

## Cobertura atual

Há calendário, edição e exclusão de lançamentos, equipe com seleção múltipla, perfis individuais, pagamentos por camarada na produção da família, painel de saldo de trocas, contagens por patrão, controle do trator e resumo por safra. Os testes automatizados ficam em `tests/`.
