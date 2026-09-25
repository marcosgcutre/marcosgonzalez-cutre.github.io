# EXUVIA — viabilidad técnica, arquitectura y alcance del MVP

Documento de trabajo que acompaña al prototipo de `exuvia/`. Distingue entre lo verificado (con fuente), lo que es decisión de diseño del prototipo y lo que es opinión técnica. Ninguna de las fuentes citadas es literatura revisada por pares: son documentación oficial de fabricantes o artículos técnicos, y así se indica.

## 1. Qué demuestra el prototipo y qué no

El prototipo es una web estática (HTML + módulos ES + three.js 0.186 desde jsDelivr) que corre en cualquier navegador con WebGL. Implementa la cadena completa que tendrá el producto: fuentes simuladas → normalizador → rasgos → reglas → genoma visual → organismo, más el sistema de mutaciones, el archivo de exuvias, la vista de reloj y la función de compartir. Hay cinco perfiles simulados (el de la imagen de referencia, el mismo con sólo Apple Watch y sin WHOOP, alguien que empieza desde cero, una vida estable sin cambios y un atleta irregular) para comprobar lo que importa en esta etapa: que datos distintos producen organismos distintos (si además son *reconocibles* para su dueño es algo que el prototipo no puede probar, ver §10), que la ausencia de un dispositivo no degrada al organismo, y que la misma persona cambia de forma de manera legible a lo largo del tiempo. La línea de tiempo permite recorrer 240 días y ver las mudas ocurrir.

No demuestra rendimiento nativo, ni integración real con ninguna API, ni el comportamiento en watchOS. La vista de reloj es una aproximación en navegador, no una prueba de lo que el hardware del reloj sostiene.

## 2. El motor de partículas

**Decisión central: la forma se calcula en la GPU.** Cada partícula tiene una semilla fija de cuatro números aleatorios. El vertex shader (`js/organism.js`) convierte esa semilla en una posición en función de 17 parámetros (el "genoma visual": expansión, coherencia, densidad, flujo, lóbulos, torsión, verticalidad, base, filamentos, respiración, brillo y cuatro pesos de paleta). La CPU nunca recorre las partículas por frame; sólo interpola esos 17 números hacia su valor objetivo. Consecuencias:

- El costo por frame es un único draw call de `N` puntos con tres evaluaciones de ruido simplex por vértice. En el navegador de escritorio de prueba (render por software, SwiftShader) se sostienen ~44 fps con 40.000 partículas; en GPU real el margen es mucho mayor. Falta medir en teléfonos concretos, y es lo primero a hacer con el prototipo publicado.
- Las transiciones entre formas son gratuitas y continuas: una mutación es una interpolación lenta de uniforms, que visualmente se lee como una muda.
- La forma es determinista: mismo genoma + misma semilla = mismo organismo. Esto permite compartir un organismo como un puñado de bytes (ver §7) y regenerar miniaturas de exuvias sin almacenar imágenes.

El límite de este enfoque es que las partículas no interactúan entre sí (no hay física, no hay "enjambre" real). Si en algún momento se busca comportamiento emergente — partículas que se atraen, que migran de una estructura a otra — hace falta simulación por GPU con texturas de posición (técnica GPGPU / "ping-pong") o compute shaders. Eso es más costoso y, en mi opinión, no hace falta para el MVP: la sensación de organismo vivo sale del ruido temporal y de la respiración, no de la física.

**Tecnología por plataforma (recomendación, no verdad):**

- *Web / prototipo:* three.js con `ShaderMaterial` sobre WebGL2, como está hecho. WebGPU sería el siguiente paso si se necesitan compute shaders.
- *iOS nativo:* el mismo shader portado a Metal (MSL). Apple declaró SceneKit en "soft deprecation" en WWDC25 y recomienda RealityKit para proyectos nuevos ([Apple, WWDC25 "Bring your SceneKit project to RealityKit"](https://developer.apple.com/videos/play/wwdc2025/288/)). Para un sistema de partículas con shader propio, Metal directo vía `MTKView` es lo más controlable; RealityKit no aporta mucho aquí.
- *Alternativa multiplataforma:* React Native o Flutter con una vista nativa para el render, o directamente una app nativa iOS primero. Dado que Apple Health **exige** una app iOS nativa (§4), empezar por iOS nativo es lo más coherente.

**Rendimiento en teléfono.** Los riesgos reales son tres, en este orden: *fill rate* (muchas partículas grandes y translúcidas sumándose con blending aditivo, sobre pantallas de alta densidad), temperatura/batería en sesiones largas, y costo del vertex shader. El prototipo ya incluye dos mitigaciones: tope de `devicePixelRatio` (1,75 en táctil) y un DPR adaptativo que baja la resolución si el dispositivo no sostiene ~45 fps, antes que quitar partículas. Faltan: limitar a 30 fps cuando el organismo está en reposo, pausar cuando la vista no está visible (el navegador ya lo hace con `requestAnimationFrame`) y un nivel de detalle por dispositivo.

## 3. Del dato a la forma: el sistema de reglas

**Principio: no hay mejor ni peor.** El organismo no califica a nadie. Cada parámetro visual se mueve entre dos extremos igual de completos (ordenada ↔ turbulenta, compacta ↔ dispersa, nube ↔ filamentos, lenta ↔ rápida), ningún dato quita partículas ni brillo (la luminosidad es fija) y el tamaño varía en un rango corto para que "más grande" no se lea como "más". Tomar o no tomar alcohol, entrenar o no entrenar, son datos que cambian la forma, no que la mejoran o la empeoran. No existe la noción de recaída: existe un cambio de patrón, y un cambio de patrón es una mutación.

Está en `js/genome.js` y se puede inspeccionar y manipular en la pestaña LAB. Tiene dos capas:

**Rasgos (features).** Diez valores entre 0 y 1, calculados sólo con datos hasta el día evaluado (nunca con el futuro). Siete son *estructurales*, de ventana larga: carga de actividad (28 días), distancia acumulada (90 d, escala logarítmica), regularidad de la práctica (días con entrenamiento o meditación por semana y su estabilidad a lo largo de 8 semanas), frecuencia de consumo (proporción de días con alcohol, azúcar o tabaco en 90 d, sólo de los hábitos que la persona registra), práctica de meditación (28 d), variedad de actividades (entropía de Shannon de los tipos de entrenamiento en 60 d, ponderada por volumen) y calidad de sueño (14 d). Tres son de *estado*, del día: recuperación, esfuerzo y tendencia de HRV (media de 7 días frente a 60). Las sumas se escalan al largo real de la ventana, para que los primeros días de uso no parezcan "menos".

**Reglas.** Cada parámetro visual es una combinación lineal de rasgos con pesos que suman 1, reescalada a un rango. Por ejemplo, `densidad = 0,5·consumo + 0,3·regularidad + 0,2·sueño`. La dirección de cada regla (que más consumo compacte en vez de dispersar, por ejemplo) es arbitraria a propósito: ninguno de los dos extremos es el deseable. Si un rasgo no tiene datos (por ejemplo, no hay WHOOP y por lo tanto no hay recuperación), vale *sin dato*, no un valor inventado, y la regla se recalcula con los pesos de los rasgos que sí existen. La tabla completa es visible en LAB.

La separación en dos escalas de tiempo es la otra decisión conceptual importante: **la forma es la memoria, el movimiento es el presente.** Lo que pasa hoy cambia la velocidad y la respiración; lo que se sostiene durante semanas cambia la estructura.

Otras decisiones implementadas: un hábito de consumo sólo cuenta desde que aparece en la historia (quien nunca fumó no tiene el rasgo, en vez de tener "cero"); un día sin registro no cuenta como ocurrencia ni como ausencia; la falta de un dispositivo no altera la forma (los rasgos sin datos se excluyen, ver arriba); y la HRV sólo se compara consigo misma dentro del mismo método de medición (ver §4). La recuperación de WHOOP ya integra HRV y sueño, así que nunca comparte regla con ellos.

Lo que este sistema **no** resuelve: los pesos son arbitrarios. Son legibles y ajustables, pero no hay nada que los fundamente más allá del criterio estético, lo cual es coherente con que el organismo sea una interpretación artística y no una medida de salud.

## 4. Integraciones con wearables

La arquitectura del prototipo separa **adaptadores** (uno por fuente, producen payloads en la forma nativa de cada API) de un **normalizador** (`js/ingest.js`) que los convierte en un resumen diario canónico. Todo lo que viene después sólo conoce el formato canónico. Esa frontera es lo que permite simular hoy y conectar mañana sin tocar el motor.

**Apple Health / Apple Watch.** HealthKit no tiene API web: los datos viven en el iPhone y sólo una app iOS nativa, con permiso del usuario, puede leerlos y, si se decide, sincronizarlos con un servidor ([Momentum, artículo técnico, no revisado por pares](https://www.themomentum.ai/blog/do-you-need-a-mobile-app-to-access-apple-health-data)). Implicación directa: **EXUVIA necesita una app iOS nativa para usar Apple Health**; una web o PWA no puede. Los datos del Apple Watch llegan por la misma vía (HealthKit).

**WHOOP.** API REST v2 con OAuth 2.0: ciclos fisiológicos (con el esfuerzo, en escala 0–21), recuperación, sueño, entrenamientos y webhooks para recuperación y sueño actualizados ([WHOOP for Developers](https://developer.whoop.com/api/); [guía de migración v1→v2](https://developer.whoop.com/docs/developing/v1-v2-migration/)). La integración va del servidor de EXUVIA a WHOOP, no desde el teléfono. Nota honesta: no pude abrir la especificación OpenAPI oficial desde este entorno (el dominio estaba bloqueado por el proxy de red), así que los nombres de campo usados en `simulator.js` (`recovery_score`, `hrv_rmssd_milli`, `resting_heart_rate`, `strain`, `sleep_performance_percentage`, `sport_name`, `distance_meter`) siguen la documentación pública tal como la conozco y deben contrastarse contra la especificación antes de integrar.

**Oura.** API v2 con OAuth2. Los tokens de acceso personal fueron discontinuados en diciembre de 2025; las integraciones nuevas deben usar OAuth, y una app recién registrada puede conectar como máximo 10 usuarios hasta que Oura la apruebe ([Oura, documentación de autenticación](https://cloud.ouraring.com/docs/authentication); el límite de 10 usuarios lo tomo de un artículo técnico de terceros, [AIFitnessAPI](https://www.aifitnessapi.com/integrate/oura-api), no de la documentación oficial, y conviene confirmarlo).

**Garmin.** La Health API del Garmin Connect Developer Program no es de autoservicio: requiere solicitud y aprobación como desarrollador comercial, con descripción del caso de uso ([Garmin Developers, Health API](https://developer.garmin.com/gc-developer-program/health-api/); [FAQ del programa](https://developer.garmin.com/gc-developer-program/program-faq/)). Es la integración con más fricción administrativa; tiene sentido dejarla fuera del MVP.

**Problemas de datos que el normalizador ya enfrenta:**

- *Métricas con el mismo nombre que no son comparables.* WHOOP reporta HRV como RMSSD; HealthKit la expone como SDNN (`HKQuantityTypeIdentifierHeartRateVariabilitySDNN`). Son estadísticos distintos y no se deben mezclar ni promediar. El prototipo guarda el método junto al valor y sólo calcula tendencias dentro del mismo método.
- *Duplicados.* Una misma carrera registrada por el Apple Watch y por WHOOP aparece dos veces. El prototipo fusiona entrenamientos del mismo tipo que empiezan con menos de 20 minutos de diferencia; en la simulación, 107 de los entrenamientos del perfil de referencia se fusionan así.
- *Prioridad de fuentes.* Recuperación, esfuerzo y sueño vienen de WHOOP si existe; pasos, energía, mindfulness y distancia de Apple Health. Esta tabla debería ser configurable por el usuario.
- *Sueño con dos medidas distintas.* WHOOP da un puntaje propio de rendimiento de sueño; Apple Watch da horas por fase (`HKCategoryTypeIdentifierSleepAnalysis`). No son comparables: el rasgo de sueño usa el puntaje de WHOOP si existe en la ventana y, si no, la duración, nunca una mezcla.
- *Zona horaria y "día".* El prototipo asigna días en UTC. En producción el día canónico tiene que ser el día local del usuario, y hay que decidir a qué día pertenece una noche de sueño o un ciclo de WHOOP que cruza la medianoche (el prototipo usa el día en que termina el sueño). Viajar cambia la zona horaria y puede duplicar o saltar un día.
- *Lo que ningún wearable sabe.* Alcohol, azúcar, tabaco: registro manual. Es la parte más frágil del sistema (depende de la honestidad y constancia del usuario) y también la más cercana al concepto.

**Límite de la simulación (circularidad).** El simulador genera fisiología a partir de las mismas suposiciones que usan las reglas: por ejemplo, que el alcohol baja la HRV del día siguiente o que meditar mejora el sueño. Por eso la simulación sólo valida que la cadena funciona (que los datos fluyen, que las ausencias se manejan, que las mudas ocurren); no valida que el organismo responda de forma sensata a datos reales. Eso sólo puede comprobarse con historias reales exportadas de Apple Health o WHOOP.

## 5. Arquitectura de datos propuesta

Opinión técnica, para discutir. Tres capas:

1. **Crudo, inmutable.** Lo que llega de cada fuente, tal cual, con fecha de ingesta. Permite reprocesar todo si cambian las reglas.
2. **Canónico diario.** Un registro por usuario y día (el `DailySummary` del prototipo), recalculable desde la capa cruda.
3. **Derivado.** Rasgos, genoma y estado de mutación por día. Es barato de recalcular: el prototipo reprocesa 240 días de historia completa en el navegador en cada cambio.

Dónde se procesa es una decisión de privacidad antes que técnica. Como HealthKit obliga a una app nativa, es posible calcular rasgos y genoma **en el dispositivo** y subir al servidor sólo el genoma (17 números por día) y el estado de mutación. WHOOP y Oura sí requieren un servidor para OAuth y webhooks, pero ese servidor podría limitarse a reenviar datos al teléfono sin almacenarlos. Las pautas de revisión de Apple imponen restricciones específicas al uso de datos de HealthKit (entre ellas, no usarlos para publicidad); hay que leerlas completas antes de diseñar el backend ([App Review Guidelines, §5.1.3](https://developer.apple.com/app-store/review/guidelines/#health-and-health-research)).

## 6. Sistema de mutaciones

Implementado en `js/mutations.js`. Una muda no es un premio: ocurre cuando la forma cambió lo suficiente, en cualquier dirección. Requiere dos condiciones: **madurez** (al menos 21 días en la forma actual) y **cambio** (la estructura se alejó al menos un 10 % de la forma con la que empezó la etapa). Los primeros 28 días son de formación: las ventanas de datos se llenan y la primera forma se fija al terminar. HOME muestra las dos condiciones como LATENCIA (días en la forma / mínimo) y DERIVA (distancia estructural / umbral), con sus valores numéricos.

Empezar a correr produce una muda; dejar de correr también. Dejar de tomar alcohol o volver a tomar, lesionarse, mudarse: todo lo que cambie el patrón de vida durante semanas cambia la forma, y si el cambio es suficiente, hay muda. Lo que no produce muda es la estabilidad, y eso tampoco es peor. En la simulación, la vida estable y el atleta irregular no mudan en 240 días: el atleta alterna dos meses de exceso con dos de abandono, y esa alternancia sostenida ya es su forma; mudaría si el patrón cambiara. Un solo día de alcohol en el perfil de referencia mueve la frecuencia de consumo de 0,039 a 0,044: queda registrado, pero no alcanza para cambiar la forma. Cada etapa se designa con el código del parámetro que más cambió y el signo del cambio (`DNS−`: la densidad bajó; `COH+`: la coherencia subió; `Ø` para la primera forma). Es una designación descriptiva, no un nombre narrativo. Cada exuvia guarda su genoma, así que puede volver a dibujarse y observarse.

Punto abierto: con los umbrales actuales, el perfil de referencia (que cambió varios hábitos en los últimos cinco meses) muda tres veces en 240 días. El umbral del 10 % define cuánto cambio es una muda; es una decisión de ritmo de la experiencia más que técnica.

## 6b. Patrones: de los datos a estructuras

Implementado en `js/patterns.js`. Además del genoma (que da la forma general), un detector busca estructura real en la historia y cada patrón encontrado se inscribe como una estructura visible. Una fracción fija de partículas (6–7 % por estructura) se reorganiza; con intensidad cero vuelven al cuerpo, así que nada aparece ni desaparece de golpe. Todo se calcula con datos hasta el día visto.

- **Ritmo semanal → anillo orbital de 7 lóbulos.** Perfil de actividad por día de la semana en 8 semanas; el radio de cada lóbulo es la actividad de ese día y la intensidad del anillo es la amplitud del perfil (desvío/media).
- **Ciclo → doble hélice.** Autocorrelación de la actividad entre 10 y 75 días, después de quitar la tendencia (media móvil de 28 d) y el componente semanal; sin ese paso, cualquier rutina semanal produce "ciclos" falsos de 56 o 63 días (múltiplos de 7). Cada vuelta de la hélice es un ciclo observado.
- **Acoplamientos → filamentos entre nodos.** Correlación de Pearson en 60 días entre pares de variables (con retardo de un día donde tiene sentido, por ejemplo alcohol de ayer ↔ HRV de hoy). Se muestran los tres con |r| ≥ 0,20. Cian si se mueven en el mismo sentido, naranja si en sentido opuesto: el color indica dirección, no valor.
- **Estratos → capas concéntricas.** Detección de cambios de nivel: para cada día se compara la media de 28 días antes con la de hasta 28 días después mediante un estadístico z; los picos con z ≥ 3,5, separados por al menos 28 días, son estratos. El radio de la capa codifica la fecha (centro = pasado, superficie = presente), como los anillos de un árbol. En el perfil de referencia caen exactamente en los días programados en la simulación (23/05 azúcar, 18/07 alcohol, 03/08 meditación).

Cuando aparece una señal nueva, la app la anuncia ("SEÑAL NUEVA · CICLO 56 D"). Lo que motiva es descubrir la propia estructura, no un puntaje.

Límite a tener presente: en la simulación, los acoplamientos que se detectan son los que el simulador codificó (por ejemplo, que el alcohol baja la HRV del día siguiente). Con datos reales serían hallazgos; aquí sólo prueban que el detector funciona. Además, una correlación en 60 días es una asociación, no una causa, y con series cortas puede ser azar: el umbral de 0,20 es deliberadamente bajo para un prototipo visual y habría que endurecerlo (y corregir por comparaciones múltiples) si alguna vez se muestra como información.

## 6c. Catálogo de hábitos, LOG y trazas

Implementado en `js/catalog.js`. Veinte hábitos concretos en cinco dominios, cada uno con un código de tres letras:

- **Sustancias:** ALC alcohol, TAB tabaco, THC cannabis, COC cocaína, CAF cafeína, AZU azúcar, UPF ultraprocesados.
- **Cuerpo:** CAR correr, FUE fuerza, SRF surf, DIV buceo, YOG yoga/movilidad, PAS pasos.
- **Mente:** MED meditación, RES respiración, LEC lectura, PAN pantallas más de 4 h.
- **Recuperación:** FRI frío, SAU sauna.
- **Nutrición:** AYU ayuno.

Los hábitos de cuerpo y la meditación se leen del wearable (AUTO); el resto se registra en la pestaña LOG tocando chips del día seleccionado. Un hábito se sigue desde el primer día en que aparece.

**Trazas.** Cada hábito seguido deja una traza propia en el organismo: una barra vertical en un espectro que rodea al cuerpo, en una posición fija por hábito, con altura igual a su frecuencia en 28 días y color según el dominio. En HOME, cada hábito tiene una fila con su tira de 28 días, el conteo y el último registro (T−n). Las sustancias alimentan además el rasgo de frecuencia de consumo, y todos los hábitos entran al detector de patrones: por ejemplo, en la simulación del atleta irregular aparece el acoplamiento COC (día anterior) ↔ SUEÑO, que es un supuesto programado en el simulador, no un dato.

**Privacidad de las sustancias.** Son los datos más sensibles de la app. Nunca se incluyen por defecto en lo que se comparte: ni como indicador en la tarjeta ni como traza en la forma (las barras de sustancias se envían en cero salvo que se active "incluir trazas de sustancias en la forma"). En producción deberían quedar sólo en el dispositivo.

**Tienda de aplicaciones.** La guía 1.4.3 de Apple no permite apps que *fomenten* el consumo de tabaco, drogas ilegales o alcohol en exceso ([App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). Registrar un consumo no es fomentarlo, y la neutralidad del diseño (ningún hábito es bueno ni malo) juega a favor, pero cómo se presenta la cocaína en la app y en la ficha de la tienda es algo a revisar antes de enviarla; no puedo asegurar cómo lo interpretaría la revisión.

## 6d. Interfaz: la del mockup

La app sigue el mockup original: cinco pestañas (HOME, MUTATIONS, ANALYTICS, EXUVIA, PROFILE).

- **HOME:** el organismo limpio en su marco, CURRENT MUTATION con los días de la forma actual y seis tarjetas de hábitos (SIN AZÚCAR 124 DÍAS, SURF SESSIONS, NO ALCOHOL, CORRIDAS, MEDITACIÓN, BUCEO). En las sustancias el número es días desde el último registro; en el resto, días con ese hábito durante la forma actual.
- **MUTATIONS:** línea de tiempo, estado de la forma en lenguaje llano ("Tu forma cambió un 91 % de lo necesario para mudar") y qué hábitos la están cambiando ("Frío: 0 → 10 días de cada 28"), más el historial de formas.
- **ANALYTICS:** los patrones en lenguaje llano ("Tu día más activo es el domingo", "Los días después de meditar, dormís mejor"); sólo en esta pestaña las estructuras de los patrones se inscriben en la forma, con etiquetas ancladas, y tocar un patrón lo aísla. Debajo, el registro del día y los últimos 28 días por hábito.
- **EXUVIA:** las pieles anteriores, una a una, con su duración y fechas.
- **PROFILE:** fuentes de datos, compartir, Apple Watch, datos crudos y lab.

## 6e. Anatomía de hábitos, respuesta inmediata y génesis

Tres cambios para que el organismo comunique en vez de decorar:

- **Anatomía de hábitos.** El organismo está hecho de tus hábitos. Cada hábito seguido le hace crecer un miembro propio en una posición fija (espiral áurea sobre el cuerpo); su largo es la frecuencia en 28 días y su morfología depende del dominio: tentáculo segmentado (cuerpo), tallo con bulbo (sustancias), doble espiral (mente), abanico (recuperación), anillo (nutrición). Dos personas con hábitos distintos tienen siluetas distintas, y la forma se puede leer: tocás un miembro, o una tarjeta, y aparece qué hábito es, cuántos días de los últimos 28 y cuándo fue la última vez. Reemplaza al espectro de barras, que era un gráfico pegado al organismo, no parte de él.
- **Respuesta inmediata.** La punta de cada miembro brilla según cuán reciente es el hábito (hoy al máximo, se apaga en unos días). Con el botón + de HOME registrás el día y el miembro se enciende al instante; si el hábito es nuevo, el miembro crece. La forma cambia el mismo día, no sólo cada semanas.
- **Génesis.** La primera vez, el organismo crece desde la historia disponible: recorre todos los días en unos segundos, deja sus pieles en el camino y termina en hoy. Con datos reales, la historia de Apple Health permite que la app arranque con una forma ya vivida en lugar de esperar semanas. Se puede volver a ver desde PROFILE.

## 6f. Ritual de esporas y muda con cáscara

- **Ritual de esporas.** El botón + de HOME agranda el organismo y lo rodea de esporas, una por hábito manual todavía no registrado ese día, con el color de su dominio. Arrastrar una espora hacia la forma (o tocarla) la registra: la espora entra al cuerpo, una onda lo recorre desde el centro y el miembro de ese hábito se enciende. Todas las esporas se absorben igual; no hay buenas ni malas.
- **Muda con cáscara.** Cuando la forma muda, la anterior se desprende como una cáscara translúcida (una segunda instancia del organismo con menos partículas, desaturada), se corre al costado, queda tenue unos segundos y se disuelve. El aviso es sobrio: "Algo cambió · Mutación 05".

## 6g. Tu exuvia es una galaxia de hábitos

El organismo pasó a ser una galaxia, generada con las mismas partículas y el mismo genoma:

- **Núcleo y brazos.** El núcleo (bulbo) es la persona. Los brazos espirales salen del genoma: cantidad de brazos (lóbulos), enrollamiento (torsión), nitidez (filamento), grosor del disco (elongación), extensión (base), barra central (amplitud de lóbulos), polvo entre brazos (entropía). Gira lento, según el flujo del día.
- **Cada hábito es un planeta.** Orbita el núcleo con una órbita más cerrada cuanto más frecuente es el hábito (un hábito nuevo aparece en el borde), con velocidad kepleriana (los cercanos giran más rápido). Tamaño = frecuencia; color = dominio; morfología por dominio: esfera con halo de gas (sustancias), estrella con corona (cuerpo), estrella doble (mente), planeta con anillo (recuperación), mundo-anillo (nutrición). Cada planeta deja una estela de partículas en su órbita. Lo reciente brilla más.
- **Patrones en la galaxia.** Ritmo semanal: halo de 7 lóbulos alrededor del núcleo. Ciclos: chorros polares en espiral. Acoplamientos: puentes de luz entre los planetas de los dos hábitos (o nodos del núcleo para actividad, sueño y HRV). Cambios de hábito: anillos en el disco, del pasado (adentro) al presente (afuera).
- **La muda es una nebulosa.** En astronomía, las estrellas como el Sol expulsan sus capas externas al final de su vida y forman una nebulosa planetaria: una piel que la estrella deja atrás. En EXUVIA, cuando la galaxia muda, su forma anterior se expande como una nebulosa translúcida y se disuelve. Las exuvias guardadas son esas nebulosas.

## 6h. Los planetas son esferas

Cada hábito es una esfera sólida y grande en la órbita de su planeta: tamaño según la frecuencia en 28 días, color según el dominio (naranja sustancias, cian cuerpo, violeta mente, azul recuperación, perla nutrición), y late suavemente si el hábito es reciente. Las esferas se dibujan como impostores (un plano orientado a la cámara con un shader que simula la esfera: luz difusa, reflejo especular y borde luminoso), así que son baratas. Alrededor sigue la galaxia de partículas, con las estelas de cada órbita y un halo tenue alrededor de cada esfera.

## 7. Compartir

Tres formatos, implementados en `js/share.js`: imagen PNG de 1080×1350 (formato vertical de Instagram), animación de 4 segundos grabada desde el canvas con `MediaRecorder` (MP4 donde el navegador lo permite, WebM si no), y un enlace. En móvil se usa la hoja de compartir del sistema (Web Share API); en escritorio, descarga.

**Privacidad por defecto:** la tarjeta sólo lleva el organismo, el número de mutación y los días en la forma actual. Cada indicador (días sin alcohol, kilómetros…) se agrega de a uno y explícitamente.

El enlace codifica el genoma y los patrones cuantizados a un byte por valor (unos 130 caracteres de enlace en total), dentro del fragmento `#` de la URL (que el navegador no envía al servidor). Quien lo abre ve el organismo vivo y rotable, sin datos. Una advertencia que conviene no pasar por alto: **el genoma no es anónimo respecto de los hábitos.** Como las reglas son públicas y casi lineales, alguien que las conozca puede estimar, por ejemplo, la densidad y deducir aproximadamente la frecuencia de consumo que hay detrás. Si eso importa, las opciones son compartir sólo la semilla de forma y la etapa, o agregar ruido al genoma compartido.

## 8. Apple Watch

Según lo que pude verificar, Apple lista RealityKit para iOS, iPadOS, macOS, tvOS y visionOS, y watchOS no aparece entre esas plataformas ([Apple, WWDC25 "What's new in RealityKit"](https://developer.apple.com/videos/play/wwdc2025/287/)); SceneKit y SpriteKit sí funcionan en watchOS (Apple tiene un ejemplo oficial, [WatchPuzzle](https://developer.apple.com/library/archive/samplecode/WatchPuzzle/Introduction/Intro.html)), aunque SceneKit quedó en modo mantenimiento desde WWDC25. No pude verificar con fuente oficial si las apps de terceros en watchOS tienen acceso directo a Metal; no lo doy por hecho.

Recomendación, en orden de riesgo creciente:

1. **Frames pre-renderizados en el iPhone.** El teléfono renderiza una secuencia corta (por ejemplo 48 frames en bucle) del organismo actual cada vez que cambia el genoma y la envía al reloj con WatchConnectivity. El reloj sólo reproduce imágenes. Es el enfoque más barato en batería y el más predecible.
2. **SpriteKit con pocas partículas en 2D.** Una proyección del organismo con 1.000–3.000 puntos, animada en el reloj. Más vivo, más costoso.
3. **SceneKit 3D.** Posible pero apoyado en un framework en mantenimiento.

La **complicación** no puede ser 3D en ningún caso razonable: el prototipo la resuelve como un anillo de puntos cuya forma y color derivan del genoma, con los días de la mutación actual en el centro. La vista de reloj del prototipo usa 2.500 partículas a 20 fps sólo como aproximación visual.

## 9. Alcance del MVP

Lo que ya existe en el prototipo corresponde a los seis puntos pedidos. Para pasar de prototipo a MVP instalable, mi propuesta (opinión) es:

- App iOS nativa con HealthKit (Apple Health + Apple Watch) y registro manual. Sin servidor para datos de salud: todo el cálculo en el dispositivo.
- WHOOP como segunda fuente, ya con un servidor mínimo para OAuth.
- Oura y Garmin fuera del MVP: la primera por el límite de usuarios hasta aprobación, la segunda por el proceso comercial.
- Reloj con el enfoque de frames pre-renderizados.
- Compartir imagen y animación. El enlace interactivo puede quedar en la web actual (este mismo prototipo en modo visitante ya lo hace).

## 10. Preguntas abiertas

Resuelto por decisión del autor: no hay formas mejores ni peores, y un cambio de patrón (cualquiera) es una mutación (§3, §6). Quedan abiertas:

- **¿El organismo es reconocible por su dueño?** El prototipo demuestra que perfiles distintos producen formas distintas; no demuestra que una persona reconozca la suya entre otras. Es algo que se puede probar con usuarios reales.
- **"Every habit leaves a trace" frente a privacidad.** Si cada hábito deja huella en la forma, la forma revela hábitos (§7). ¿Hasta dónde se quiere que el organismo compartido sea legible?

## Fuentes

Ninguna es revisada por pares; son documentación oficial de los fabricantes o artículos técnicos.

- Apple. (2025). *Bring your SceneKit project to RealityKit* [video de WWDC25]. https://developer.apple.com/videos/play/wwdc2025/288/
- Apple. (2025). *What's new in RealityKit* [video de WWDC25]. https://developer.apple.com/videos/play/wwdc2025/287/
- Apple. (s. f.). *WatchPuzzle: Using SceneKit and SpriteKit on watchOS* [código de ejemplo]. https://developer.apple.com/library/archive/samplecode/WatchPuzzle/Introduction/Intro.html
- Apple. (s. f.). *App Review Guidelines*. https://developer.apple.com/app-store/review/guidelines/
- Garmin. (s. f.). *Health API — Garmin Connect Developer Program*. https://developer.garmin.com/gc-developer-program/health-api/
- Momentum. (s. f.). *Do you need a mobile app to access Apple Health data?* https://www.themomentum.ai/blog/do-you-need-a-mobile-app-to-access-apple-health-data
- Oura. (s. f.). *Oura API: Authentication*. https://cloud.ouraring.com/docs/authentication
- WHOOP. (s. f.). *WHOOP API docs*. https://developer.whoop.com/api/
- WHOOP. (s. f.). *v1 to v2 migration guide*. https://developer.whoop.com/docs/developing/v1-v2-migration/
