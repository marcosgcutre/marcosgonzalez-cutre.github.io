# EXUVIA — viabilidad técnica, arquitectura y alcance del MVP

Documento de trabajo que acompaña al prototipo de `exuvia/`. Distingue entre lo verificado (con fuente), lo que es decisión de diseño del prototipo y lo que es opinión técnica. Ninguna de las fuentes citadas es literatura revisada por pares: son documentación oficial de fabricantes o artículos técnicos, y así se indica.

## 1. Qué demuestra el prototipo y qué no

El prototipo es una web estática (HTML + módulos ES + three.js 0.186 desde jsDelivr) que corre en cualquier navegador con WebGL. Implementa la cadena completa que tendrá el producto: fuentes simuladas → normalizador → rasgos → reglas → genoma visual → organismo, más el sistema de mutaciones, el archivo de exuvias, la vista de reloj y la función de compartir. Hay cuatro perfiles simulados (el de la imagen de referencia, el mismo con sólo Apple Watch y sin WHOOP, alguien que empieza desde cero y un atleta irregular) para comprobar lo que importa en esta etapa: que datos distintos producen organismos distintos (si además son *reconocibles* para su dueño es algo que el prototipo no puede probar, ver §10), que la ausencia de un dispositivo no degrada al organismo, y que la misma persona cambia de forma de manera legible a lo largo del tiempo. La línea de tiempo permite recorrer 240 días y ver las mudas ocurrir.

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

Está en `js/genome.js` y se puede inspeccionar y manipular en la pestaña LAB. Tiene dos capas:

**Rasgos (features).** Diez valores entre 0 y 1, calculados sólo con datos hasta el día evaluado (nunca con el futuro). Siete son *estructurales*, de ventana larga: carga de actividad (28 días), distancia acumulada (90 d, escala logarítmica), regularidad de la práctica (días con entrenamiento o meditación por semana y su estabilidad a lo largo de 8 semanas), abstinencia sostenida (75 % proporción de días limpios en 90 d, 25 % racha actual en escala logarítmica), práctica de meditación (28 d), variedad de actividades (entropía de Shannon de los tipos de entrenamiento en 60 d, ponderada por volumen) y calidad de sueño (14 d). Tres son de *estado*, del día: recuperación, esfuerzo y tendencia de HRV (media de 7 días frente a 60).

**Reglas.** Cada parámetro visual es una combinación lineal de rasgos con pesos que suman 1, reescalada a un rango. Por ejemplo, `densidad = 0,5·abstinencia + 0,3·regularidad + 0,2·sueño`. Si un rasgo no tiene datos (por ejemplo, no hay WHOOP y por lo tanto no hay recuperación), vale *sin dato*, no un valor inventado, y la regla se recalcula con los pesos de los rasgos que sí existen. La tabla completa es visible en LAB.

La separación en dos escalas de tiempo es la decisión conceptual más importante del sistema: **la forma es la memoria, el movimiento es el presente.** Un mal día cambia la velocidad, el brillo y la respiración, pero no destruye una estructura construida en meses. Esto evita que la app castigue, y es coherente con la exigencia de prudencia sobre los datos fisiológicos.

Decisiones de prudencia implementadas: ninguna regla es punitiva (valores bajos atenúan y aquietan, no deforman ni "enferman" al organismo); una abstinencia sólo cuenta desde que ese hábito aparece en la historia (quien nunca fumó no gana densidad por "no fumar"); un día sin registro no rompe una racha (olvidarse de anotar no es recaer: la racha son los días desde la última ocurrencia registrada); una recaída deja marca pero no borra meses (en la simulación, un día de alcohol tras 68 días limpios baja la densidad de 0,90 a 0,85); la falta de un dispositivo no penaliza (los rasgos sin datos se excluyen, ver arriba); y la HRV sólo se compara consigo misma dentro del mismo método de medición (ver §4). La recuperación de WHOOP ya integra HRV y sueño, así que no se combina con ellos en una misma regla.

Lo que este sistema **no** resuelve y conviene discutir: los pesos son arbitrarios. Son legibles y ajustables, pero no hay nada que los fundamente más allá del criterio estético. Eso es aceptable si se asume que el organismo es una interpretación artística, pero entonces la app no debería insinuar en ningún lugar que un organismo "mejor" corresponde a una salud mejor.

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

Implementado en `js/mutations.js`. Una muda requiere tres condiciones simultáneas: **madurez** (al menos 21 días en la forma actual), **rastro** (suficiente constancia y actividad acumuladas desde la última muda; el umbral crece con cada etapa) y **cambio real** (la estructura actual se alejó al menos un 10 % de la forma con la que empezó la etapa, medida sobre los parámetros estructurales). HOME muestra las tres como líneas finas en lugar de una barra de experiencia.

La tercera condición es la que separa esto de un sistema de niveles: si sólo pasa el tiempo o sólo se acumula esfuerzo, pero la vida no cambia de forma, no hay muda. En la simulación del atleta irregular esto se ve con claridad: entrena mucho más que el perfil de referencia, pero su estructura oscila y en 240 días muda sólo dos veces, con una etapa de 153 días. La etapa nueva recibe el nombre del parámetro que más cambió y de la dirección del cambio (por ejemplo DISCIPLINE si la coherencia sube, FLUX si baja); los nombres son provisorios y son una decisión de autor. Cada exuvia guarda su genoma, así que puede volver a dibujarse y observarse.

Punto abierto: con los umbrales actuales el perfil de referencia muda cuatro veces en 240 días, con etapas de entre 35 y 86 días. Si se buscan mudas más raras y significativas, los umbrales tienen que subir; es una decisión de ritmo de la experiencia más que técnica.

## 7. Compartir

Tres formatos, implementados en `js/share.js`: imagen PNG de 1080×1350 (formato vertical de Instagram), animación de 4 segundos grabada desde el canvas con `MediaRecorder` (MP4 donde el navegador lo permite, WebM si no), y un enlace. En móvil se usa la hoja de compartir del sistema (Web Share API); en escritorio, descarga.

**Privacidad por defecto:** la tarjeta sólo lleva el organismo, el número de mutación y los días en la forma actual. Cada indicador (días sin alcohol, kilómetros…) se agrega de a uno y explícitamente.

El enlace codifica el genoma cuantizado a un byte por parámetro, en total unos 26 caracteres, dentro del fragmento `#` de la URL (que el navegador no envía al servidor). Quien lo abre ve el organismo vivo y rotable, sin datos. Una advertencia que conviene no pasar por alto: **el genoma no es anónimo respecto de los hábitos.** Como las reglas son públicas y casi lineales, alguien que las conozca puede estimar, por ejemplo, la densidad y deducir aproximadamente cuánta abstinencia sostenida hay detrás. Si eso importa, las opciones son compartir sólo la semilla de forma y la etapa, o agregar ruido al genoma compartido.

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

Dejo esto como tensiones del concepto, no como respuestas:

- **¿Qué significa que el organismo "mejore"?** Si más constancia produce más densidad, orden y brillo, el sistema tiene una estética normativa aunque no lo diga: hay organismos más deseables que otros. Eso lo acerca a la gamificación que el concepto dice evitar. ¿Querés que exista una forma "mejor", o que cada trayectoria produzca formas distintas sin jerarquía?
- **¿Qué pasa con las recaídas?** Hoy una recaída reinicia la racha visible y baja la densidad unos puntos, marca que se diluye a lo largo de 90 días. ¿Debería dejar además una huella permanente (una cicatriz en la forma) o desaparecer con el tiempo?
- **¿Quién puede mudar?** El rastro que habilita una muda premia regularidad y actividad. Alguien lesionado o en reposo prolongado cambia de vida pero no acumula rastro, y por lo tanto no muda. Es una jerarquía implícita, del mismo tipo que la de la primera pregunta. La alternativa es que el rastro mida cuánto cambió la forma, en cualquier dirección, y no cuánto se hizo.
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
