async function searchRoute() {
    const start = document.getElementById("start").value.trim();
    const slut = document.getElementById("slut").value.trim();
    const output = document.getElementById("output");

    if (!start || !slut) {
        output.innerHTML = "Fyll i både start och slut.";
        return;
    }

    // Ladda datan
    const data = await fetch("data.json").then(res => res.json());

    // Hitta matchande driftplatser
    const dpStart = data.driftsplatser.find(d => 
        d.name.toLowerCase().includes(start.toLowerCase()) ||
        d.short.toLowerCase() === start.toLowerCase()
    );

    const dpSlut = data.driftsplatser.find(d => 
        d.name.toLowerCase().includes(slut.toLowerCase()) ||
        d.short.toLowerCase() === slut.toLowerCase()
    );

    if (!dpStart || !dpSlut) {
        output.innerHTML = "Kunde inte hitta en eller båda driftplatserna.";
        return;
    }

    // Filtrera bandelar där båda driftplatserna finns
    const bandelar = data.bandelar.filter(b => 
        b.points.includes(dpStart.short) && 
        b.points.includes(dpSlut.short)
    );

    if (bandelar.length === 0) {
        output.innerHTML = "Start och slut ligger inte på samma bandel (ännu ej stödd multi-bandel-sökning).";
        return;
    }

    // Hitta linjeböcker som täcker dessa bandelar
    const linjebocker = data.linjebocker.filter(lb =>
        lb.bandelar.some(b => bandelar.map(x => x.id).includes(b))
    );

    output.innerHTML = `
        <strong>Start:</strong> ${dpStart.name} (${dpStart.short})<br>
        <strong>Slut:</strong> ${dpSlut.name} (${dpSlut.short})<br><br>

        <strong>Träffade bandelar:</strong><br>
        ${bandelar.map(b => `${b.id} (${b.from}–${b.to})`).join("<br>")}<br><br>

        <strong>Linjeböcker:</strong><br>
        ${linjebocker.map(lb => `${lb.id}: ${lb.name}`).join("<br>")}
    `;
}
